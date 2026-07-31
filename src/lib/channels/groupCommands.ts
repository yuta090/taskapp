/**
 * 登録済み（claimed）グループの1発言を、どの合図なのか振り分ける共通層。
 *
 * これまで「完了N」だけが各チャネルの handler に個別に書かれていた。使い方案内（ヘルプ）と
 * その場の登録（タスク追加）を足すにあたり、7チャネル分の分岐を7箇所にコピーすると必ずズレる
 * ので、**振り分けはここ1本に集約する**（claimLimboCore.ts が limbo 側で取っているのと同じ形）。
 *
 * 守る不変条件:
 *   - **どの合図にも一致しなければ完全沈黙**（返信も記録もしない）。普通の会話に割り込まない。
 *   - **完了Nの判定を最初に置く**（既存の分岐順序を変えない）。文法は排他なので結果は同じだが、
 *     順序を動かさないこと自体が「無挙動変更」の担保になる。
 *   - **送信は必ず返信(reply)**。push の口をそもそも持たないので、LINE 無料枠を消費しない。
 *   - 未登録（limbo）グループはここに来ない。limbo でヘルプに答えると、bot が居ること・
 *     どう動くかを外部から確かめられる「オラクル」になるため、沈黙の原則を絶対に緩めない。
 *
 * 完了Nの処理は claimLimboCore.runDigestCompletion をそのまま呼ぶ（文言・順序を1文字も変えない）。
 */

import { parseDigestCompleteCommand } from '@/lib/channels/digest/commands'
import {
  parseAddTaskCommand,
  parseCompleteWithoutNumberCommand,
  parseHelpCommand,
  parseListCommand,
} from '@/lib/channels/textCommands'
import { renderHelpReplyText } from '@/lib/channels/commandGuides'
import {
  buildTaskDetailLine,
  buildTaskListMoreText,
  DIGEST_LIST_ROWS_CAP,
  TASK_LIST_MORE_UNKNOWN_TEXT,
} from '@/lib/channels/digest/compute'
import { formatDateToLocalString } from '@/lib/gantt/dateUtils'
import { jstNow } from '@/lib/datetime/jstNow'
import {
  processClaimLimbo,
  runDigestCompletion,
  type ClaimLimboDeps,
  type ClaimLimboParams,
  type DigestCompletionDeps,
  type DigestCompletionOutboundInput,
} from '@/lib/channels/claimLimboCore'
import type {
  CreateInstantDigestTaskInput,
  CreateInstantDigestTaskResult,
} from '@/lib/channels/store'
import {
  advanceTutorial,
  startTutorial,
  type TutorialDeps,
  type TutorialGroupContext,
  type TutorialNumberedTask,
  type TutorialSignal,
} from '@/lib/channels/tutorial/run'
import type { ChannelTutorialState } from '@/lib/channels/tutorial/state'

// 「タスク追加」への返信文言はここが単一の正本（各 handler で重複定義しない）。
export const ADD_TASK_EMPTY_TEXT =
  'タスクの内容が読み取れませんでした。「タスク追加 見積もりを送る」のように、続けて内容を書いてください。'

/**
 * 責任者の承認が要るタスクになったときの返信文言。**ここが単一の正本**。
 * LINE のメンション即時タスク化（line/webhookHandler.ts）も同じ文言を使うので、
 * あちらはこの定数を読み込む（同じ文章を2箇所に書かない）。
 */
export const APPROVAL_REQUESTED_TEXT =
  '責任者に確認をお願いしました。承認されると本体タスクになります。'

/**
 * タスクを1件お預かりできたときの返信文言。
 *
 * 「明日の朝」とは書かない。まとめの配信時刻はグループごとに設定でき、当日の夕方に届くことも
 * あるため（事実と違う約束をしない）。
 */
export function buildAddTaskDoneText(title: string): string {
  // 「一覧」は打つ合図の名前なので、定期的に届くほうは「お知らせ」と呼ぶ（1つのものを2つの名前で呼ばない）。
  return `「${title}」をお預かりしました。次にお届けするお知らせに載ります。`
}

/**
 * 拾い方が「取り込まない(off)」のグループでお預かりしたときの返信文言。**ここが単一の正本**。
 *
 * ⚠ このグループには**まとめが永久に届かない**（配信対象の絞り込みで pickup_mode='off' を外している）。
 *   それなのに「次にお届けする一覧に載ります」と返すのは、果たされない約束＝嘘になる。
 *   預かったこと自体は本当なので、そこは伝えたうえで「自動では届かない」「見たいときは『一覧』」
 *   という事実だけを渡す。
 */
export function buildAddTaskDoneNoDigestText(title: string): string {
  return `「${title}」をお預かりしました。このグループは自動のお知らせを止めているので、まとめは届きません。いまのタスクを見たいときは「一覧」と送ってください。`
}

/**
 * 合図の処理が途中で転んだときの返信文言。**ここが単一の正本**。
 *
 * ⚠ 黙らない: 打った本人には「効かなかった」ことすら分からず、壊れていると受け取られる。
 *   webhook を非200で返せば送り直される、というのはチャネルによって成り立たない
 *   （送り直さないチャネルもあり、送り直すチャネルでは二重処理の危険がある）ので、
 *   **その場で伝える**のが唯一確実な手当て。
 */
export const COMMAND_FAILED_TEXT =
  'うまく処理できませんでした。少し時間をおいて、もう一度同じように送ってください。'

/** 一覧に出すもの（採番の結果）。期限・担当はあれば添える。 */
export interface GroupNumberedTask extends TutorialNumberedTask {
  dueDate?: string | null
  dueTime?: string | null
  assigneeHint?: string | null
}

/**
 * 「一覧」と送られたが、いまお預かりしているタスクが1件も無いときの返事。**ここが単一の正本**。
 * 0件でも黙らない（黙ると「壊れている」と受け取られる）。
 */
export const LIST_EMPTY_TEXT = 'いまお預かりしているタスクはありません。'

/**
 * 番号を付けずに「完了」とだけ送られたときの返事。**ここが単一の正本**。
 *
 * 案内は「終わったら『完了3』と送ってください」と読めるので、番号を落とす人が必ず出る。
 * ここで黙ると打った本人は詰む（何が悪いのか分からない）。番号の付け方と、
 * 番号が分からないときの逃げ道（「一覧」）の両方をこの1通に入れる。
 */
export const COMPLETE_WITHOUT_NUMBER_TEXT =
  '番号を付けて「完了 3」のように送ってください。番号が分からないときは「一覧」と送ると、いまのタスクを番号付きでお送りします。'

/**
 * 一覧に並べる最大件数。
 *
 * ⚠ 上限が無いと、タスクが溜まったグループでは1通が送信上限を超えて**送信そのものが失敗**する
 *   ＝「一覧」と打っても永久に無反応になる。打ったのに無反応、が今回いちばん直したかった失敗そのもの。
 */
export const TASK_LIST_MAX_ITEMS = 20

/**
 * 一覧1通の最大文字数。**いちばん厳しいチャットに合わせた共通の安全側**。
 *
 * 1通あたりの上限は Discord が2000字ともっとも厳しく（LINE 5000・Telegram 4096・Slack以降はさらに緩い）、
 * チャネルごとに上限差を持ち回る仕組みは送信層に存在しない。差を持ち込むより、
 * **どのチャットでも確実に届く1つの安全値**に寄せる方が壊れにくい（一覧は20件も出れば十分に用が足りる）。
 * どうしても緩めたいチャネルが出たら buildTaskListReplyText の第3引数で個別に渡す。
 */
export const TASK_LIST_MAX_CHARS = 1800

/**
 * 打ち切ったときの断り書きと、1度に読む行数の上限。正本は digest/compute.ts
 * （まとめ本体と「一覧」で同じ文・同じ上限を使う）。ここは呼び出し元のための再輸出だけ。
 */
export { buildTaskListMoreText, DIGEST_LIST_ROWS_CAP }

/**
 * 「一覧」への返事。**まとめ（digest）と同じ並び・同じ番号をそのまま出す**。
 *
 * ⚠ 番号は振り直さない。振り直すと、利用者の手元に残っている前の一覧の番号が別のタスクを指し、
 *   「完了3」で身に覚えのないタスクが消える。番号が飛んでいて（1, 3, 7…）も、そのまま出すのが正しい。
 *
 * ⚠ 件数・文字数で必ず打ち切る（送信上限を超えると1通まるごと送れず無反応になる）。
 *   打ち切っても総数は文頭に出すので、「全部で何件あるか」は分かる。
 *
 * todayJst は formatDateToLocalString(jstNow()) を渡す（期限の「今日/明日」表示の基準）。
 */
export function buildTaskListReplyText(
  items: GroupNumberedTask[],
  todayJst: string,
  limits: { maxItems?: number; maxChars?: number } = {},
): string {
  if (items.length === 0) return LIST_EMPTY_TEXT
  const maxItems = Math.max(1, limits.maxItems ?? TASK_LIST_MAX_ITEMS)
  const maxChars = limits.maxChars ?? TASK_LIST_MAX_CHARS

  const lines = items.map((item) => {
    const detail = buildTaskDetailLine(
      item.dueDate ?? null,
      item.dueTime ?? null,
      item.assigneeHint ?? null,
      todayJst,
    )
    return detail ? `${item.digestNumber}. ${item.title}  ${detail}` : `${item.digestNumber}. ${item.title}`
  })
  // 例に使う番号は必ず「実際に出している先頭のタスク」の番号にする（打ち切っても対応が崩れない）。
  const example = items[0].digestNumber

  // 読み取り上限ちょうどまで来ているときは、本当の総数を知らない（もっとあるかもしれない）。
  // 知らない数を言い切らない（「200件」と断定すると、251件目以降が存在ごと消える）。
  const capped = items.length >= DIGEST_LIST_ROWS_CAP
  const countLabel = capped ? `${DIGEST_LIST_ROWS_CAP}件以上` : `${items.length}件`

  const assemble = (shown: number): string => {
    const rest = items.length - shown
    const more = capped
      ? [TASK_LIST_MORE_UNKNOWN_TEXT]
      : rest > 0
        ? [buildTaskListMoreText(rest)]
        : []
    return [
      `いまお預かりしているタスクです（${countLabel}）`,
      ...lines.slice(0, shown),
      ...more,
      `終わったものは「完了 ${example}」のように番号でお知らせください。`,
    ].join('\n')
  }

  let shown = Math.min(items.length, maxItems)
  let text = assemble(shown)
  // 1件ずつ減らす（タイトルは50字で切り詰め済みなので、数回で必ず収まる）。
  while (shown > 1 && text.length > maxChars) {
    shown -= 1
    text = assemble(shown)
  }
  return text
}

export interface GroupCommandParams<TChannel extends string> {
  orgId: string
  spaceId: string | null
  accountId: string
  groupId: string
  channel: TChannel
  externalUserId: string | null
  /** outbound.payload.autoReplyTo に残す元メッセージの参照（チャネルごとに形式が異なる） */
  autoReplyTo: string
  /** 記録済み inbound メッセージの id（タスクの出どころ） */
  sourceMessageId: string
  /** 本文。bot宛メンションは呼び出し側で剥がし済み */
  text: string
  /** channel_groups.created_at（ISO）。登録直後の練習で「前からある接続」を除くのに使う */
  groupCreatedAt?: string | null
  /** channel_groups.metadata。練習の進み具合の置き場所 */
  groupMetadata?: Record<string, unknown> | null
  /**
   * 「タスク追加 ○○」がこのグループで実際に効くか（既定 true）。LINE は拾い方の設定によって
   * 効かない場合があるため呼び出し側が渡す。効かないなら練習を始めない。
   */
  addTaskEnabled?: boolean
  /**
   * channel_groups.pickup_mode（拾い方）。**返事で嘘をつかないためだけに使う**。
   * 'off' のグループは毎朝のまとめ配信の対象から外れる＝「次にお届けする一覧に載ります」が
   * 果たされない約束になるため、返す文言を実態に合わせる。
   * 分からない（未指定）ときは既定どおり＝まとめは届く前提の文言にする。
   */
  pickupMode?: string
}

/**
 * 登録直後の練習（対話型チュートリアル）に要る配線。**3つ揃ったときだけ練習が動く**。
 * 揃わなければ従来どおり（合図の振り分けだけ）＝既存の呼び出し側を壊さない。
 */
export interface TutorialWiring {
  /**
   * いま一覧に出るタスクを番号順で返す。**番号がまだ無いタスクにだけ**続きの番号を与える関数を
   * 渡すこと（store.assignDigestNumbersToNewTasks）。番号の総入れ替え
   * （clearAndRenumberOpenDigestTasks）は配信直前の cron だけの仕事で、ここから呼ぶと
   * 利用者の手元の一覧と番号がズレる。
   *
   * ⚠ **必須**（省略可にしない）。練習だけでなく「一覧」コマンドの土台でもあるため、
   *   配線を1チャネルでも忘れると、そのチャネルだけ「一覧」と打っても無反応になる。
   *   打ったのに無反応、が今回いちばん直したかった失敗そのものなので、型で防ぐ。
   */
  assignDigestNumbersToNewTasks: (groupId: string) => Promise<GroupNumberedTask[]>
  /** channel_groups.metadata へのマージ更新 */
  updateGroupMetadata?: (groupId: string, patch: { tutorial: ChannelTutorialState }) => Promise<void>
  now?: () => Date
}

export interface GroupCommandDeps<TChannel extends string> extends TutorialWiring {
  completeDigestTask: DigestCompletionDeps<TChannel>['completeDigestTask']
  createInstantDigestTask: (input: CreateInstantDigestTaskInput) => Promise<CreateInstantDigestTaskResult>
  reply: (text: string) => Promise<{ providerMessageId: string | null }>
  insertOutbound: DigestCompletionDeps<TChannel>['insertOutbound']
}

export type GroupCommandMatch =
  | 'complete'
  | 'complete_hint'
  | 'help'
  | 'list'
  | 'add_task'
  | 'failed'
  | null

/**
 * 「タスク追加」を受けたときの返事を選ぶ。**実態と違う約束をしないための1箇所**。
 *   承認待ち → 一覧の話をしない（まだ番号が付かない）
 *   拾い方=off → まとめは届かないと伝える（この一覧は永久に来ない）
 *   それ以外 → 従来どおり
 */
function buildAddTaskReplyText<TChannel extends string>(
  title: string,
  pending: boolean,
  params: GroupCommandParams<TChannel>,
): string {
  if (pending) return APPROVAL_REQUESTED_TEXT
  if (params.pickupMode === 'off') return buildAddTaskDoneNoDigestText(title)
  return buildAddTaskDoneText(title)
}

/** 秘書の発話を返信し、outbound として記録する（完了Nの記録と同じ形にそろえる）。 */
async function replyAndRecord<TChannel extends string>(
  params: GroupCommandParams<TChannel>,
  deps: GroupCommandDeps<TChannel>,
  text: string,
): Promise<void> {
  const replyResult = await deps.reply(text)
  const outbound: DigestCompletionOutboundInput<TChannel> = {
    orgId: params.orgId,
    spaceId: params.spaceId,
    accountId: params.accountId,
    groupId: params.groupId,
    channel: params.channel,
    direction: 'outbound',
    actor: 'secretary',
    body: text,
    payload: { autoReplyTo: params.autoReplyTo, provider_message_id: replyResult.providerMessageId },
    status: 'sent',
    error: null,
    // toISOString(): timestamptz瞬時値用途（date-onlyではない・既存踏襲）。
    occurredAt: new Date().toISOString(),
  }
  await recordOutboundQuietly(params, deps, outbound)
}

/**
 * 秘書の発話を outbound として記録する。**記録の失敗は上へ投げない**。
 *
 * ⚠ 返信はもう届いているので、ここで転んで失敗扱いにすると
 *   「『見積もりを送る』を完了にしました。」→「うまく処理できませんでした。もう一度同じように送ってください。」
 *   の2通が並ぶ。言われたとおり打ち直すと今度は「そのタスクは既に完了済みです。」と返り、
 *   何が起きたのか分からなくなる。
 *   記録は監査のためのもので、利用者の操作結果には影響しない。落ちたらログだけ残す。
 */
async function recordOutboundQuietly<TChannel extends string>(
  params: GroupCommandParams<TChannel>,
  deps: GroupCommandDeps<TChannel>,
  outbound: DigestCompletionOutboundInput<TChannel>,
): Promise<void> {
  try {
    await deps.insertOutbound(outbound)
  } catch (error) {
    console.error('[groupCommand] outbound record failed', params.groupId, params.channel, error)
  }
}

/**
 * 練習（対話型チュートリアル）の配線を組み立てる。3つ揃っていなければ null＝練習は動かない。
 * 秘書の発話は完了N・ヘルプと同じく outbound として記録する（監査ログをそろえる）。
 */
function buildTutorial<TChannel extends string>(
  params: GroupCommandParams<TChannel>,
  deps: GroupCommandDeps<TChannel>,
): { group: TutorialGroupContext; deps: TutorialDeps } | null {
  const { assignDigestNumbersToNewTasks, updateGroupMetadata, now } = deps
  if (!updateGroupMetadata) return null
  return {
    group: {
      groupId: params.groupId,
      channel: params.channel,
      createdAt: params.groupCreatedAt ?? null,
      metadata: params.groupMetadata ?? null,
      addTaskEnabled: params.addTaskEnabled,
    },
    deps: {
      reply: (text) => replyAndRecord(params, deps, text),
      saveTutorialState: (groupId, state) => updateGroupMetadata(groupId, { tutorial: state }),
      assignDigestNumbersToNewTasks,
      now: now ?? (() => new Date()),
    },
  }
}

/**
 * 練習を1歩進める。**練習の失敗が本流（完了・登録・ヘルプの返事）を壊さないよう必ず握る**。
 * 練習は「あると嬉しい案内」であって、タスクの取り扱いそのものではないため。
 */
async function runTutorial<TChannel extends string>(
  params: GroupCommandParams<TChannel>,
  deps: GroupCommandDeps<TChannel>,
  signal: TutorialSignal,
): Promise<void> {
  const tutorial = buildTutorial(params, deps)
  if (!tutorial) return
  try {
    await advanceTutorial(tutorial.group, signal, tutorial.deps)
  } catch (error) {
    console.error('[tutorial] advance failed', params.groupId, error)
  }
}

/**
 * claimed グループの1発言を処理する。どのコマンドにも一致しなければ完全沈黙
 * （練習中のグループだけは、そこで「あとで」や案内の遅れ出しを拾う）。
 * 呼び出し元で本文は既に通常発言として記録済み（監査ログ）。
 *
 * ★合図の処理が転んだら**必ず「うまくいかなかった」と伝えて**から終わる（黙らない）。
 *   例外をそのまま上へ投げ返さないのは意図的:
 *     - 打った人への手当ては「その場で伝える」以外に確実な手段がない（送り直しの有無はチャネル任せ）
 *     - 投げ返すと webhook が非200になり、送り直すチャネルでは同じ合図が二重に処理される
 *   本文の記録・claim（登録）はこの関数より前に済んでいるので、握っても本流は壊れない。
 */
export async function handleClaimedGroupMessage<TChannel extends string>(
  params: GroupCommandParams<TChannel>,
  deps: GroupCommandDeps<TChannel>,
): Promise<{ matched: GroupCommandMatch }> {
  try {
    return await dispatchClaimedGroupMessage(params, deps)
  } catch (error) {
    console.error('[groupCommand] failed', params.groupId, params.channel, error)
    try {
      await replyAndRecord(params, deps, COMMAND_FAILED_TEXT)
    } catch (noticeError) {
      // 失敗のお知らせすら送れない（送信そのものが落ちている）。ここで打つ手は無い。
      console.error('[groupCommand] failure notice failed', params.groupId, noticeError)
    }
    return { matched: 'failed' }
  }
}

async function dispatchClaimedGroupMessage<TChannel extends string>(
  params: GroupCommandParams<TChannel>,
  deps: GroupCommandDeps<TChannel>,
): Promise<{ matched: GroupCommandMatch }> {
  const text = params.text
  if (!text) return { matched: null }

  // (1) 完了N — 既存の判定を先頭に置いたまま動かさない
  const digestNumber = parseDigestCompleteCommand(text)
  if (digestNumber !== null) {
    // 練習で登録したタスクが消えたのかを見分けるため、完了できた行を横から控えておく
    // （claimLimboCore.runDigestCompletion は返り値を持たない＝あちらは1文字も変えない）。
    let completed: { id: string; title: string } | null = null
    await runDigestCompletion(
      {
        orgId: params.orgId,
        spaceId: params.spaceId,
        accountId: params.accountId,
        groupId: params.groupId,
        channel: params.channel,
        externalUserId: params.externalUserId,
        autoReplyTo: params.autoReplyTo,
      },
      digestNumber,
      {
        completeDigestTask: async (groupId, number, externalUserId) => {
          completed = await deps.completeDigestTask(groupId, number, externalUserId)
          return completed
        },
        reply: deps.reply,
        // 記録の失敗をここで吸う（claimLimboCore は1文字も変えない）。
        // 返信はもう届いているので、監査ログが書けなかっただけで
        // 「うまく処理できませんでした」を重ねて出さない（理由は recordOutboundQuietly）。
        insertOutbound: (outbound) => recordOutboundQuietly(params, deps, outbound),
      },
    )
    await runTutorial(params, deps, {
      kind: 'complete',
      digestNumber,
      completedTaskId: (completed as { id: string } | null)?.id ?? null,
    })
    return { matched: 'complete' }
  }

  // (1-b) 番号なしの「完了」 — 黙ると詰むので、番号の付け方と逃げ道（「一覧」）を返す。
  //       「完了1」は上で処理済みなのでここには来ない。
  if (parseCompleteWithoutNumberCommand(text)) {
    await replyAndRecord(params, deps, COMPLETE_WITHOUT_NUMBER_TEXT)
    return { matched: 'complete_hint' }
  }

  // (2) ヘルプ — 使い方を持たないチャット（1:1専用など）では答えない。
  //     案内できる操作が無いのに返事だけすると、できない操作を期待させてしまう。
  if (parseHelpCommand(text)) {
    const helpText = renderHelpReplyText(params.channel)
    if (!helpText) return { matched: null }
    await replyAndRecord(params, deps, helpText)
    // ヘルプでは練習の段階を進めない（使い方はいつでも見られてよい）
    await runTutorial(params, deps, { kind: 'help' })
    return { matched: 'help' }
  }

  // (2-b) 一覧 — いまのタスクを番号付きで出し直す。番号を見失った人の逃げ道。
  //       採番は「番号がまだ無いタスクにだけ」続きを与える関数（既存の番号は1つも動かさない）。
  if (parseListCommand(text)) {
    const tasks = await deps.assignDigestNumbersToNewTasks(params.groupId)
    await replyAndRecord(params, deps, buildTaskListReplyText(tasks, formatDateToLocalString(jstNow())))
    return { matched: 'list' }
  }

  // (3) タスク追加 ○○
  const addTask = parseAddTaskCommand(text)
  if (addTask) {
    if (!addTask.title) {
      await replyAndRecord(params, deps, ADD_TASK_EMPTY_TEXT)
      return { matched: 'add_task' }
    }
    const created = await deps.createInstantDigestTask({
      groupId: params.groupId,
      sourceMessageId: params.sourceMessageId,
      title: addTask.title,
      // 頼んだ本人を担当の手がかりとして残す（identity解決は取り込み後の自己修復に任せる）
      assigneeExternalUserId: params.externalUserId,
    })
    // 責任者の承認が要るグループでは、まだ一覧に載らない・番号も付かない。
    // 「一覧に載ります」と言うと嘘になるので、LINE と同じ承認待ちの文言を返す。
    // 拾い方が「取り込まない(off)」のグループも同じ理由で文言を変える（まとめが永久に届かない）。
    await replyAndRecord(params, deps, buildAddTaskReplyText(addTask.title, created.pending, params))
    await runTutorial(params, deps, {
      kind: 'add_task',
      taskId: created.id,
      pending: created.pending,
      title: addTask.title,
    })
    return { matched: 'add_task' }
  }

  // どの合図でもない普通の発言 — 沈黙。
  // 例外は練習だけ: 練習中なら「あとで」を拾い、まだ案内していない新しいグループなら
  // ここで練習の入り口を出す（コンソール承認で成立した接続の受け皿）。
  await runTutorial(params, deps, { kind: 'other', text })
  return { matched: null }
}

// ---- 未登録（limbo）グループ ----

export interface LimboGroupParams extends ClaimLimboParams {
  /** registry の ChannelId。使い方を持たないチャットでは練習を始めない */
  channel: string
}

export interface LimboGroupDeps extends ClaimLimboDeps, TutorialWiring {
  /**
   * 成立の見極め用。**claimCreated:true のときだけ**引く。
   * processClaimLimbo の claimCreated は「code_only の成立」と「web_approval の受付(承認待ち)」の
   * 両方で true になるため、これだけでは登録できたか分からない。直前まで未登録だったグループが
   * 今 active になっていれば、code_only で本当に登録できたと判断できる
   * （teams/webhookHandler.ts が既に採っている見分け方と同じ形）。
   */
  findActiveGroup?: (
    accountId: string,
    externalGroupId: string,
  ) => Promise<{ id: string; createdAt?: string | null; metadata?: Record<string, unknown> | null } | null>
}

/**
 * 未登録（limbo）グループの1発言を処理する。**応答は processClaimLimbo のまま1文字も変えない**
 * （コードでない発言は無保存・無返信、無効コードは同一文言）。登録が本当に成立したときにだけ、
 * 後ろに練習の入り口を1通足す。
 *
 * 送るのは返信(reply)なので、LINE の無料送信枠を消費しない。
 */
export async function handleLimboGroupMessage(
  params: LimboGroupParams,
  deps: LimboGroupDeps,
): Promise<{ claimCreated: boolean }> {
  const result = await processClaimLimbo(params, deps)
  if (!result.claimCreated) return result

  const { findActiveGroup, assignDigestNumbersToNewTasks, updateGroupMetadata } = deps
  if (!findActiveGroup || !assignDigestNumbersToNewTasks || !updateGroupMetadata) return result

  // 練習の案内は「あると嬉しい」もの。ここで転んでも登録の成立は巻き戻さない。
  try {
    const group = await findActiveGroup(params.accountId, params.externalGroupId)
    if (!group) return result // 承認待ち（web_approval）＝まだ登録されていない
    await startTutorial(
      {
        groupId: group.id,
        channel: params.channel,
        createdAt: group.createdAt ?? null,
        metadata: group.metadata ?? null,
      },
      {
        // limbo の応答は outbound として記録しない既存の作法に合わせる（記録の形を変えない）
        reply: deps.reply,
        saveTutorialState: (groupId, state) => updateGroupMetadata(groupId, { tutorial: state }),
        assignDigestNumbersToNewTasks,
        now: deps.now ?? (() => new Date()),
      },
    )
  } catch (error) {
    console.error('[tutorial] start after claim failed', params.externalGroupId, error)
  }
  return result
}
