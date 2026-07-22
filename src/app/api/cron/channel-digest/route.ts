import { NextRequest, NextResponse } from 'next/server'
import {
  findDigestEligibleGroups,
  findGroupTextMessagesSince,
  ingestDigestTasks,
  clearAndRenumberOpenDigestTasks,
  findLineAccountById,
  findIdentityIdsByExternalUserIds,
  reconcileDigestAssignees,
  getOrgChannelPolicyState,
  getPlatformBudgetState,
  insertChannelMessage,
  findExistingDigestTaskSourceMessageIds,
  findUserIdsWithActiveLink,
} from '@/lib/channels/store'
import { pushLineMessage } from '@/lib/channels/line/client'
import { callLlm } from '@/lib/ai/client'
import { classifyExtractionSkip, isPoolExhaustedSkip, type DigestSkipKind } from '@/lib/ai/digestSkip'
import { notifyPoolExhausted } from '@/lib/ai/poolExhaustedNudge'
import {
  buildDigestExtractionPrompt,
  parseLlmDigestExtraction,
  buildDigestPushText,
  buildDigestFlexMessage,
  buildDigestRetryKey,
  resolveAssignee,
} from '@/lib/channels/digest/compute'
import { formatDateToLocalString } from '@/lib/gantt/dateUtils'
import { jstNow } from '@/lib/datetime/jstNow'
import { getJstDayOfYear } from '@/lib/channels/metering/decideAutoPush'
import { decideSharedSendBudget } from '@/lib/channels/metering/decideSharedSendBudget'
import { nudgeFreeCapReached } from '@/lib/channels/freeCapNudge'
import { resolveOrgEntitlements, type Feature } from '@/lib/billing/entitlements'
import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  findDueDigestTodayCandidatesForSpace,
  findDueDigestOverdueCandidatesForSpace,
  findConnectionFreshnessBatch,
  isOrgDueRemindersEnabled,
  findDueReminderDisabledUserIds,
} from '@/lib/reminders/dueReminderStore'
import { isConnectionFresh } from '@/lib/reminders/dueReminderStaleness'
import { buildDueDigestSectionText } from '@/lib/reminders/dueReminderMessages'

/**
 * POST /api/cron/channel-digest
 *
 * pg_cron が毎朝7時(JST) app_invoke_channel_digest() 経由で pg_net から呼び出す内部API。
 * digest対象グループ（active×pickup_mode<>'off'×accountがactive）ごとに:
 *   1. pickup_mode='all'/'all_plus_instant'（フェーズ2・pro以上限定）のみ: 抽出水位より後の
 *      グループ発言をLLMで抽出し、原子INSERT＋水位更新（exactly-once）。all_plus_instant は
 *      さらに、webhookのメンション即時タスク化で既にタスク化済みの発言を候補から除外する
 *      （即時タイトルとLLM抽出タイトルは一致しないため unique制約だけでは二重登録を防げない）。
 *   2. openな申し送りタスクを再採番し、0件でなければLINEへpush
 *
 * 1グループの失敗が他グループを止めない（Promise.allSettled）。
 * org_ai_config未設定orgはそのグループの抽出だけスキップしてログに残す。
 *
 * 認証: Authorization: Bearer ${CRON_SECRET}（client-remindersと同一パターン）。
 */
export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('[channel-digest] CRON_SECRET is not configured')
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }

  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const groups = await findDigestEligibleGroups()
  // JST日付。同日中にcronが再実行されてもretryKeyが同じになりLINE側で二重配信を弾ける
  const jstNowDate = jstNow()
  const jstDateStr = formatDateToLocalString(jstNowDate)
  // 期限セクション(§9)の「期限超過」下限=7日前まで（code review #4是正・古い超過タスクが
  // 下限無しで毎日全件並び続けdigestが埋もれるのを防ぐ）。jstNowDateはローカルgetterがJST値を
  // 返すDate（jstNow()の契約）なので、setDateして読み戻せばJSTの日付になる（due.tsのaddDaysと
  // 同じ作法）。
  // page-perf再レビュー是正: 旧版にあった「翌日まで」の上限取得は廃止した。due_soon(翌日)は
  // 下流で常に捨てていた（無駄な取得だった）うえ、「本日が期限」は
  // findDueDigestTodayCandidatesForSpace が jstDateStr の一致でピンポイントに取得する。
  const dueDigestFromDate = new Date(jstNowDate)
  dueDigestFromDate.setDate(dueDigestFromDate.getDate() - 7)
  const dueDigestFromDateJst = formatDateToLocalString(dueDigestFromDate)
  // 鮮度判定(isConnectionFresh)は絶対時刻比較が必要なため、jstNowDate(絶対時刻ではない・
  // jstNow()の契約上の注意)ではなく素の now を使う。
  const realNow = new Date()

  const admin = createAdminClient() as SupabaseClient
  // org単位でエンタイトルメントを1回だけ解決してキャッシュ（期限セクション: per-task「担当者に
  // DMで届くか」判定に line_direct_dm entitlement を使う・§9.1。旧版コメントの「timed_line_reminders
  // 非保持orgのみに出す」はv1時点の org 単位判定の名残で、うざくない秘書 再設計後の実装とは
  // 既にずれていたため是正した）。
  const entitlementCache = new Map<string, Promise<{ has: (f: Feature) => boolean }>>()
  function getEntitlementsCached(orgId: string) {
    let cached = entitlementCache.get(orgId)
    if (!cached) {
      cached = resolveOrgEntitlements(admin, orgId, realNow)
      entitlementCache.set(orgId, cached)
    }
    return cached
  }

  // org単位の自動期限リマインドオンオフ（org_channel_policy.due_reminders_enabled・§2）。
  // 送信境界(due-reminder-sender)と同じキルスイッチをdigestの期限セクションにも適用する。
  const orgDueRemindersEnabledCache = new Map<string, Promise<boolean>>()
  function getOrgDueRemindersEnabledCached(orgId: string) {
    let cached = orgDueRemindersEnabledCache.get(orgId)
    if (!cached) {
      cached = isOrgDueRemindersEnabled(orgId)
      orgDueRemindersEnabledCache.set(orgId, cached)
    }
    return cached
  }

  let extractedTasks = 0
  let digestsSent = 0
  // AI未設定で抽出が止まっているorgの数。サイレントスキップを止め、応答サマリでも可視化する。
  let aiUnconfiguredGroups = 0
  const skipped: Array<{ groupId: string; reason: string; kind?: DigestSkipKind }> = []
  const errors: string[] = []

  // digestは同一（共有bot）accountを複数グループが繰り返し引くため、グローバル予算層の読取を
  // account単位でメモ化する（同一cron実行内でのDB呼び出し削減。値そのものは同一実行内で不変）。
  const platformBudgetStateCache = new Map<string, Promise<Awaited<ReturnType<typeof getPlatformBudgetState>>>>()
  function getPlatformBudgetStateCached(accountId: string) {
    let cached = platformBudgetStateCache.get(accountId)
    if (!cached) {
      cached = getPlatformBudgetState(accountId)
      platformBudgetStateCache.set(accountId, cached)
    }
    return cached
  }

  await Promise.allSettled(
    groups.map(async (group) => {
      try {
        // 抽出は pickup_mode='all'/'all_plus_instant' のみ実行する（mention_only はメンション
        // 即時タスク化で拾うため、夜間LLM抽出との二重登録を避けて経路を分ける。
        // off はfindDigestEligibleGroupsで対象外）
        const extractionEligible = group.pickupMode === 'all' || group.pickupMode === 'all_plus_instant'
        const rawMessages = extractionEligible
          ? await findGroupTextMessagesSince(group.id, group.lastExtractedMessageCreatedAt)
          : []

        // all_plus_instant の重複排除（フェーズ2）: 既にメンション即時タスク化済み
        // （webhookのmention即時パス経由）の発言を抽出候補から除外する。'all' は即時タスクが
        // 存在しないモードのため、このフィルタ自体を呼ばない（no-op・従来と同一挙動を保つ）。
        let messages = rawMessages
        let dedupeFailed = false
        if (group.pickupMode === 'all_plus_instant' && rawMessages.length > 0) {
          try {
            const existingSourceMessageIds = await findExistingDigestTaskSourceMessageIds(
              group.id,
              rawMessages.map((m) => m.id),
            )
            messages = rawMessages.filter((m) => !existingSourceMessageIds.has(m.id))
          } catch (error) {
            // 除外判定が一時障害の場合、誤って二重登録するより抽出を1回遅らせる方が安全。
            // 水位は進めず次回cronで再取得・再判定する
            dedupeFailed = true
            const reason = error instanceof Error ? error.message : String(error)
            skipped.push({ groupId: group.id, reason: `dedupe_failed: ${reason}` })
          }
        }

        if (rawMessages.length > 0 && !dedupeFailed) {
          if (messages.length === 0) {
            // all_plus_instant: 抽出対象の全発言が既に即時タスク化済み。LLMは呼ばず、
            // 水位だけ生取得(rawMessages)の最後まで進める（同じバッチを再取得し続けないため）
            extractedTasks += await ingestDigestTasks(
              group.id,
              rawMessages[rawMessages.length - 1].createdAt,
              [],
            )
          } else {
            try {
              const now = jstNow()
              const prompt = buildDigestExtractionPrompt(
                messages.map((message, index) => ({ index, body: message.body })),
                now,
              )
              const llmResponse = await callLlm({ orgId: group.orgId, messages: prompt, maxTokens: 1500 })
              const extracted = parseLlmDigestExtraction(llmResponse.content, now)

              if (extracted === null) {
                skipped.push({ groupId: group.id, reason: 'llm_response_unparseable' })
              } else {
                const resolved = extracted
                  .filter((task) => messages[task.sourceIndex] !== undefined)
                  .map((task) => ({
                    task,
                    message: messages[task.sourceIndex],
                    // メンション（発話者の明示的な指名）はLLMの推測より確か。上書きさせない
                    assignee: resolveAssignee(messages[task.sourceIndex].mentions, task.assigneeHint),
                  }))

                // メンションで取れたuserIdを既存identityに解決する（未友だちの人は null のまま残る）
                // 必ずこのグループの space で解決する（他顧問先のidentityを引かない）
                const identities = await findIdentityIdsByExternalUserIds(
                  group.orgId,
                  group.spaceId,
                  resolved
                    .map((r) => r.assignee.assigneeExternalUserId)
                    .filter((id): id is string => id !== null),
                )

                const candidates = resolved.map(({ task, message, assignee }) => ({
                  sourceMessageId: message.id,
                  title: task.title,
                  assigneeHint: assignee.assigneeHint,
                  assigneeExternalUserId: assignee.assigneeExternalUserId,
                  assigneeIdentityId: assignee.assigneeExternalUserId
                    ? (identities.get(assignee.assigneeExternalUserId) ?? null)
                    : null,
                  dueDate: task.dueDate,
                  dueTime: task.dueTime,
                }))
                // 水位は生取得(rawMessages)の最後まで進める。all_plus_instantの重複排除で除外が
                // あってもここは変えない（除外された発言だけを毎回再取得し続けないため）
                const newWatermark = rawMessages[rawMessages.length - 1].createdAt
                extractedTasks += await ingestDigestTasks(group.id, newWatermark, candidates)
              }
            } catch (error) {
              // org_ai_config未設定・LLM API障害等。このグループの抽出だけスキップし、配信(既存open分)は継続する。
              // ただし黙って握り潰さない: AI未設定(設定ギャップ・要オペ対応)とLLM障害を切り分けて必ずログに残す。
              const reason = error instanceof Error ? error.message : String(error)
              // 型(AiConfigError)で分類する。復号失敗も設定ギャップ(ai_unconfigured)として可視化する。
              const kind = classifyExtractionSkip(error)
              if (kind === 'ai_unconfigured') {
                aiUnconfiguredGroups += 1
                // 設定ギャップ = 自動タスク化が止まっている。org単位でgrep可能な運用シグナルを残す。
                console.warn(
                  `[channel-digest] ai_unconfigured org=${group.orgId} group=${group.id}: ${reason}`,
                )
                // プールAI(当社鍵)の当月上限到達だけは、事務所へ「自社AIキー登録で即時復旧」を
                // 促す（org×月で1回・ベストエフォート）。相手先グループには一切出さない。
                if (isPoolExhaustedSkip(error)) {
                  try {
                    await notifyPoolExhausted({
                      orgId: group.orgId,
                      spaceId: group.spaceId,
                      jstMonthKey: jstDateStr.slice(0, 7),
                    })
                  } catch (err) {
                    // 通知失敗は cron を壊さない（抽出スキップは既に確定・skipped 済み）
                    console.error('[channel-digest] pool-exhausted notify failed', group.orgId, err)
                  }
                }
              } else {
                console.error(
                  `[channel-digest] extraction_failed org=${group.orgId} group=${group.id}: ${reason}`,
                )
              }
              skipped.push({ groupId: group.id, reason, kind })
            }
          }
        }

        // 配信前の自己修復: identity作成と申し送りINSERTがすれ違って担当が未解決のまま
        // 残った分を、同一spaceのidentityへ解決しなおす（取りこぼしを毎朝ならす）。
        // 失敗しても配信自体は続ける（担当が付かないだけで、申し送りは届けたい）
        try {
          await reconcileDigestAssignees(group.id)
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error)
          skipped.push({ groupId: group.id, reason: `reconcile_failed: ${reason}` })
        }

        // 配信: 新規抽出の有無によらず、既存のopenタスクも含めて毎朝再採番してから送る
        const numbered = await clearAndRenumberOpenDigestTasks(group.id)

        // 期限セクション（設計正本 §9・安全網v2・うざくない秘書 再設計）: 「中立な予定表」として
        // グループへ出す。旧版は「timed_line_reminders非保持orgのみ」に出していたが、新版は
        // per-task「DMで届かない場合」に条件を変えた（Proでも担当者にDMルートが無ければ載せる・
        // 重複防止のためDMルートがあるタスクは除外する）。org単位オンオフ・個人opt-out・
        // §6鮮度抑止も同様に適用する。
        // ⚠ この判定は「申し送りタスク0件」の早期returnより前に置く — 早期returnの後ろだと
        // 「申し送りは無いが期限は迫っている」org（＝タスクツール未使用者への安全網の
        // 主対象）にリマインドが一切届かなくなり、この機能の狙いそのものが無効化される。
        let dueSectionText = ''
        try {
          if (group.spaceId) {
            const orgDueRemindersEnabled = await getOrgDueRemindersEnabledCached(group.orgId)
            if (orgDueRemindersEnabled) {
              // page-perf再レビュー是正: 本日分/超過分を別クエリ・別limit(25)枠で並列取得する。
              // 旧版は1クエリ`.order('due_date').limit(50)`で両方まとめていたため、超過タスクが
              // 50件を超えて積み上がったspaceでは due_date昇順の枠を古い超過タスクが食い尽くし、
              // 「本日が期限」セクションが常に空になっていた（安全網が最も必要な「未整理の事務所」
              // で今日やるべき仕事が1件も出ない＝実効性の重大な欠落）。分割済みなのでkindは
              // クエリの出自から自明＝呼び出し側でclassifyDueForDigestを使う必要も無くなった。
              const [todayCandidates, overdueCandidates] = await Promise.all([
                findDueDigestTodayCandidatesForSpace(group.spaceId, jstDateStr),
                findDueDigestOverdueCandidatesForSpace(group.spaceId, dueDigestFromDateJst, jstDateStr),
              ])
              const dueCandidates = [
                ...todayCandidates.map((c) => ({ ...c, kind: 'due_today' as const })),
                ...overdueCandidates.map((c) => ({ ...c, kind: 'overdue_confirm' as const })),
              ]
              if (dueCandidates.length > 0) {
                const connectionIds = dueCandidates
                  .map((c) => c.dueAuthorityConnectionId)
                  .filter((id): id is string => id !== null)
                const freshnessMap = await findConnectionFreshnessBatch(connectionIds)
                const freshCandidates = dueCandidates.filter((c) => {
                  // §6 鮮度抑止: external権威タスクは接続がactive×SLA内のときだけ載せる
                  if (!c.dueAuthorityConnectionId) return true
                  return isConnectionFresh(freshnessMap.get(c.dueAuthorityConnectionId) ?? null, realNow)
                })

                if (freshCandidates.length > 0) {
                  const entitlements = await getEntitlementsCached(group.orgId)
                  const canDirectDm = entitlements.has('line_direct_dm')
                  const assigneeIds = [...new Set(freshCandidates.map((c) => c.assigneeId))]

                  // per-task「DMで届くか」判定（届くタスクはdigestに出さない・重複防止）と
                  // 個人単位のオプトアウト(profiles.due_reminder_enabled)は互いに独立したクエリ
                  // なので並列実行する（perf是正: 以前は直列awaitで後者が前者の解決を待っていた）。
                  const [dmLinkedUserIds, optedOutUserIds] = await Promise.all([
                    canDirectDm
                      ? findUserIdsWithActiveLink(group.orgId, assigneeIds)
                      : Promise.resolve(new Set<string>()),
                    findDueReminderDisabledUserIds(assigneeIds),
                  ])

                  const dueItems = freshCandidates
                    .filter((c) => !dmLinkedUserIds.has(c.assigneeId))
                    .filter((c) => !optedOutUserIds.has(c.assigneeId))
                    .map((c) => ({ kind: c.kind, title: c.title }))
                  dueSectionText = buildDueDigestSectionText(dueItems, jstDateStr)
                }
              }
            }
          }
        } catch (error) {
          // 期限セクションの取得に失敗しても既存のdigest配信自体は止めない
          const reason = error instanceof Error ? error.message : String(error)
          skipped.push({ groupId: group.id, reason: `due_section_failed: ${reason}` })
        }

        // 申し送りタスクも期限セクションも無ければ何もしない（従来どおり）
        if (numbered.length === 0 && !dueSectionText) return

        const account = await findLineAccountById(group.accountId)
        if (!account) {
          errors.push(`group ${group.id}: line account not found`)
          return
        }

        // 送信境界の縮退判定（設計正本 §3/§7-10）。digestはauto-push。due-onlyのpush
        // （申し送り0件・期限セクションのみ）もこのgateを必ず通す（予算境界の外に漏らさない・
        // code review #1是正）。gate対象外（webhook対話的push・console手動送信）はここを通らない。
        // org層(policy)＋グローバル予算層(共有bot account軸の実物理上限)の二層判定（fable確定設計）。
        // 専用bot(owner_type='org')は顧客側の枠であり当社の持ち出しではないため常に'ok'扱い。
        const policy = await getOrgChannelPolicyState(group.orgId)
        const globalState =
          account.ownerType === 'platform' ? await getPlatformBudgetStateCached(account.id) : 'ok'
        const decision = decideSharedSendBudget({
          org: { state: policy.state, onExceed: policy.onExceed },
          global: { state: globalState },
          // getJstDayOfYear は内部で jstNow() を掛けるため、素の now を渡す。
          // jstNowDate（既に jstNow 済み）を渡すと二重変換で UTC 環境だけ1日ずれる。
          jstDayOfYear: getJstDayOfYear(),
        })
        if (!decision.deliver) {
          skipped.push({ groupId: group.id, reason: decision.reason ?? 'quota_suppressed' })
          // 無料50到達(org層 block×hard = quota_block_suppress)なら、事務所へアップグレード導線＋
          // 相手先グループへ中立の1行（org×月で1回・ベストエフォート）。共有bot(platform)限定
          // ＝有料の自社bot(owner_type='org')は on_exceed='none' で block しないため対象外。
          if (decision.reason === 'quota_block_suppress' && account.ownerType === 'platform') {
            try {
              await nudgeFreeCapReached({
                orgId: group.orgId,
                spaceId: group.spaceId,
                account,
                groupExternalId: group.externalGroupId,
                jstMonthKey: jstDateStr.slice(0, 7),
                globalBudgetHard: globalState === 'hard',
              })
            } catch (err) {
              // 促し失敗は cron を壊さない（抑止は既に確定・skipped 済み）
              console.error('[channel-digest] free-cap nudge failed', group.orgId, err)
            }
          }
          return
        }

        // 期限順（近い順→期限なし）に採番済み。超過は ⚠️ で示す（Stage 2.6 §5）。
        // 申し送りタスクが0件（due-onlyのpush）なら申し送り本文は作らず期限セクションのみにする。
        const digestText =
          numbered.length > 0
            ? buildDigestPushText(
                numbered.map((task) => ({
                  digestNumber: task.digestNumber,
                  title: task.title,
                  dueDate: task.dueDate,
                  dueTime: task.dueTime,
                  assigneeHint: task.assigneeHint,
                })),
                jstDateStr,
              )
            : ''
        const pushText = [digestText, dueSectionText].filter((part) => part.length > 0).join('\n\n')
        // flex（消し込みボタン）は申し送りタスクが無ければ添付しない（due-onlyのpushはtextのみ）
        const flex =
          numbered.length > 0
            ? buildDigestFlexMessage(
                numbered.map((task) => ({
                  digestNumber: task.digestNumber,
                  title: task.title,
                  taskId: task.id,
                })),
              )
            : null

        // outbound記録のexternalMessageIdと同一キーにする（Fix4: 決定的キーでdedupe。
        // 二重起動(pg_net再送・手動再実行)でもchannel_messages_dedupe unique indexにより
        // 二重計上しない＝誤ってsoft/hardへ遷移して正当な配信を抑止する事故を防ぐ）。
        // due-onlyのpushもgroup×日で決定的な同じretryKeyを使う＝1グループ1日1通の枠を共有し、
        // 二重送信はLINE側dedupeが弾く（既存digestとdue-onlyが同時に生じるケースは無い設計）。
        const retryKey = buildDigestRetryKey(group.id, jstDateStr)
        await pushLineMessage({
          accessToken: account.accessToken,
          to: group.externalGroupId,
          messages: flex ? [{ type: 'text', text: pushText }, flex] : [{ type: 'text', text: pushText }],
          retryKey,
        })
        digestsSent += 1

        // push成功後にoutbound記録（billablePush=true）を残す。真実の源=channel_messagesから
        // メータリングを導出するため（設計正本 §3）。
        await insertChannelMessage({
          orgId: group.orgId,
          spaceId: group.spaceId,
          identityId: null,
          accountId: account.id,
          groupId: group.id,
          channel: 'line',
          direction: 'outbound',
          actor: 'secretary',
          externalUserId: null,
          externalMessageId: retryKey,
          contentType: 'text',
          body: pushText,
          payload: {},
          storagePath: null,
          status: 'sent',
          error: null,
          occurredAt: new Date().toISOString(),
          billablePush: true,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        errors.push(`group ${group.id}: ${message}`)
      }
    }),
  )

  if (aiUnconfiguredGroups > 0) {
    // 実行サマリにも1行残す（個別のwarnに加え、1回のcronで何org止まっているかを一目で）。
    console.warn(
      `[channel-digest] ${aiUnconfiguredGroups} group(s) skipped extraction: AI未設定（自動タスク化が停止中）`,
    )
  }

  return NextResponse.json({
    processedGroups: groups.length,
    extractedTasks,
    digestsSent,
    aiUnconfiguredGroups,
    skipped,
    errors,
  })
}
