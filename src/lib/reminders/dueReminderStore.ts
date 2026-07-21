import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { DueReminderOccurrenceDraft } from './dueReminderPlanner'
import type { DueAuthorityConnectionInfo } from './dueReminderStaleness'
import type { DueReminderBall } from './dueReminderMessages'
import { jstNow } from '@/lib/datetime/jstNow'
import { formatDateToLocalString } from '@/lib/gantt/dateUtils'

/**
 * 期限リマインドのデータアクセス層（service role専用・設計正本 §4.2/§4.3/§6/§7/§9・PR-1/PR-2）。
 * PR-0/PR-2 で導入済みのスキーマ・RPC（task_due_reminder_occurrences・
 * tasks.due_authority_connection_id・integration_connections.last_import_success_at・
 * rpc_confirm_task_done_via_line・rpc_snooze_due_reminder_via_line）を読み書き/呼び出すだけで、
 * migration/RPC/トリガーの定義自体は一切追加しない（本PRのスコープ外・別担当が用意）。
 */

function admin(): SupabaseClient {
  return createAdminClient() as SupabaseClient
}

// ---------------------------------------------------------------------------
// planner: 対象抽出 ＋ occurrence materialize（§6.1）
// ---------------------------------------------------------------------------

export interface DueReminderCandidateTaskRow {
  id: string
  dueDate: string | null
  status: string
  assigneeId: string | null
}

/**
 * occurrence生成の候補タスク。DBクエリでも due_date IS NOT NULL / status<>'done' /
 * assignee_id IS NOT NULL を絞るが、最終判定は呼び出し側の純関数
 * （dueReminderPlanner.isDueReminderEligible）にも重複させる（defense-in-depth）。
 *
 * code review #5是正: due_date に窓（今日(JST)−2日 〜 +2日）を掛け、全org・無窓の全件スキャンを
 * 避ける。既定オフセット([-1440,0,+1440]分=1日前/当日/超過1日後)とgrace(24h)を包含する幅
 * （例: 明日dueのタスクはdue_soon(-1日)がscheduled_at=今日9時になる → 今日+1日は窓内に必要）。
 * plannerは周期実行（毎時）されるため、遠い未来のdueも「今日」が近づくにつれて自然に窓へ入り、
 * 生成の正しさ（必要なoccurrenceは全て作られる）は変わらない。窓は取得件数を絞るだけの最適化。
 */
export async function findDueReminderCandidateTasks(
  now: Date = new Date(),
): Promise<DueReminderCandidateTaskRow[]> {
  const jstToday = jstNow(now)
  const fromDate = new Date(jstToday)
  fromDate.setDate(fromDate.getDate() - 2)
  const throughDate = new Date(jstToday)
  throughDate.setDate(throughDate.getDate() + 2)
  const fromDateJst = formatDateToLocalString(fromDate)
  const throughDateJst = formatDateToLocalString(throughDate)

  const { data, error } = await admin()
    .from('tasks')
    .select('id, due_date, status, assignee_id')
    .not('due_date', 'is', null)
    .neq('status', 'done')
    .not('assignee_id', 'is', null)
    .gte('due_date', fromDateJst)
    .lte('due_date', throughDateJst)

  if (error) throw new Error(`tasks: due reminder candidate query failed: ${error.message}`)

  return (data ?? []).map((row) => {
    const r = row as { id: string; due_date: string | null; status: string; assignee_id: string | null }
    return { id: r.id, dueDate: r.due_date, status: r.status, assigneeId: r.assignee_id }
  })
}

/**
 * occurrence を (task_id, due_snapshot, offset_minutes) の unique 制約に対して
 * on conflict do nothing で materialize する（PR-0 migration の unique index に依拠。
 * 本関数はRPC/トリガーを新規に足さない）。返り値は実際に新規insertされた件数。
 */
export async function materializeDueReminderOccurrences(
  drafts: DueReminderOccurrenceDraft[],
): Promise<number> {
  if (drafts.length === 0) return 0

  const rows = drafts.map((d) => ({
    task_id: d.taskId,
    kind: d.kind,
    offset_minutes: d.offsetMinutes,
    due_snapshot: d.dueSnapshot,
    scheduled_at: d.scheduledAt,
  }))

  const { data, error } = await admin()
    .from('task_due_reminder_occurrences')
    .upsert(rows, { onConflict: 'task_id,due_snapshot,offset_minutes', ignoreDuplicates: true })
    .select('id')

  if (error) throw new Error(`task_due_reminder_occurrences: materialize failed: ${error.message}`)
  return data?.length ?? 0
}

// ---------------------------------------------------------------------------
// sender: 送信直前の再読取り（§6 staleness）＋ org/接続の解決
// ---------------------------------------------------------------------------

export interface DueReminderTaskSnapshot {
  id: string
  title: string
  status: string
  dueDate: string | null
  assigneeId: string | null
  ball: DueReminderBall
  spaceId: string
  dueAuthorityConnectionId: string | null
  /**
   * connector_task_links.external_list_id（このタスクの所属コンテナID）。task-sync エンジン経由の
   * 取り込みで active リンクが有る場合のみ埋まる。external権威が無い/リンクが無い場合は null
   * （dueReminderStaleness.ts のコンテナ単位抑止をフォールバックさせるための入力）。
   */
  externalListId: string | null
}

/** claimしたoccurrenceのtask_idを送信直前に再読取りする（§6 staleness 3条件の入力）。 */
export async function findTaskSnapshotForReminder(
  taskId: string,
): Promise<DueReminderTaskSnapshot | null> {
  const { data, error } = await admin()
    .from('tasks')
    .select('id, title, status, due_date, assignee_id, ball, space_id, due_authority_connection_id')
    .eq('id', taskId)
    .maybeSingle()

  if (error) throw new Error(`tasks: reminder snapshot query failed: ${error.message}`)
  if (!data) return null

  const row = data as {
    id: string
    title: string
    status: string
    due_date: string | null
    assignee_id: string | null
    ball: string
    space_id: string
    due_authority_connection_id: string | null
  }

  // external権威（due_authority_connection_id有り）のタスクだけ、所属コンテナ(external_list_id)を
  // 引く。内部管理のタスクにまで問い合わせを増やさない（不要なクエリ・N+1の回避）。
  let externalListId: string | null = null
  if (row.due_authority_connection_id) {
    const { data: linkData, error: linkError } = await admin()
      .from('connector_task_links')
      .select('external_list_id')
      .eq('task_id', row.id)
      .eq('connection_id', row.due_authority_connection_id)
      .eq('state', 'active')
      .maybeSingle()
    if (linkError) throw new Error(`connector_task_links: external_list_id lookup failed: ${linkError.message}`)
    externalListId = (linkData as { external_list_id?: string | null } | null)?.external_list_id ?? null
  }

  return {
    id: row.id,
    title: row.title,
    status: row.status,
    dueDate: row.due_date,
    assigneeId: row.assignee_id,
    ball: row.ball === 'client' ? 'client' : 'internal',
    spaceId: row.space_id,
    dueAuthorityConnectionId: row.due_authority_connection_id,
    externalListId,
  }
}

/** タスクの帰属org（tasks.space_id -> spaces.org_id）。entitlement再確認・宛先解決の起点。 */
export async function findOrgIdForSpace(spaceId: string): Promise<string | null> {
  const { data, error } = await admin()
    .from('spaces')
    .select('org_id')
    .eq('id', spaceId)
    .maybeSingle()

  if (error) throw new Error(`spaces: org lookup failed: ${error.message}`)
  return (data as { org_id?: string } | null)?.org_id ?? null
}

/** 単票の接続鮮度情報（sender の staleness 判定用）。見つからなければ null（=証明不能）。 */
export async function findConnectionFreshness(
  connectionId: string,
): Promise<DueAuthorityConnectionInfo | null> {
  const { data, error } = await admin()
    .from('integration_connections')
    .select('status, provider, last_import_success_at, import_missing_containers')
    .eq('id', connectionId)
    .maybeSingle()

  if (error) throw new Error(`integration_connections: freshness lookup failed: ${error.message}`)
  if (!data) return null

  const row = data as {
    status: string
    provider: string
    last_import_success_at: string | null
    import_missing_containers: Record<string, string> | null
  }
  return {
    status: row.status,
    provider: row.provider,
    lastImportSuccessAt: row.last_import_success_at,
    importMissingContainers: row.import_missing_containers ?? {},
  }
}

/**
 * 利用者本人の「秘書からの期限リマインドを受け取る」オプトアウト設定
 * (profiles.due_reminder_enabled)。sender が送信直前（entitlement再確認と同じ位置づけ）に
 * 参照し、false なら suppressed('recipient_opted_out') にする。
 *
 * fail-open: 行が見つからない/列がnull の場合は true（受け取る）を返す。オプトアウトは
 * 明示的にfalseを立てた場合のみ効く（プロフィール未作成のユーザーを誤って抑止しないため）。
 */
export async function isDueReminderEnabledForUser(userId: string): Promise<boolean> {
  const { data, error } = await admin()
    .from('profiles')
    .select('due_reminder_enabled')
    .eq('id', userId)
    .maybeSingle()

  if (error) throw new Error(`profiles: due_reminder_enabled lookup failed: ${error.message}`)

  const enabled = (data as { due_reminder_enabled?: boolean | null } | null)?.due_reminder_enabled
  return enabled ?? true
}

// ---------------------------------------------------------------------------
// channel-digest: 期限セクション（occurrence非依存の直接クエリ・§9）
// ---------------------------------------------------------------------------

export interface DueDigestCandidateRow {
  id: string
  title: string
  dueDate: string
  ball: DueReminderBall
  dueAuthorityConnectionId: string | null
}

/**
 * digest配信時点の期限window直接クエリ（occurrence非依存・§9）。throughDateJst以前(超過含む)〜
 * 当日〜翌日までを対象にする（planner既定オフセットの粒度に揃える）。呼び出し側で
 * classifyDueForDigest によりさらに絞り込む。
 *
 * code review #4是正: fromDateJst で下限も掛ける（既定=今日(JST)−7日想定・呼び出し側が算出）。
 * 下限が無いと何ヶ月も前に超過した古いタスクまで毎日全件並び続け、digestが埋もれる
 * （plannerのoverdue_confirmは+1日1回のみ生成のため、粒度を揃える意味でも古い超過は対象外にする）。
 */
export async function findDueDigestCandidatesForSpace(
  spaceId: string,
  fromDateJst: string,
  throughDateJst: string,
): Promise<DueDigestCandidateRow[]> {
  const { data, error } = await admin()
    .from('tasks')
    .select('id, title, due_date, ball, due_authority_connection_id')
    .eq('space_id', spaceId)
    .not('due_date', 'is', null)
    .not('assignee_id', 'is', null)
    .neq('status', 'done')
    .gte('due_date', fromDateJst)
    .lte('due_date', throughDateJst)

  if (error) throw new Error(`tasks: due digest candidate query failed: ${error.message}`)

  return (data ?? []).map((row) => {
    const r = row as {
      id: string
      title: string
      due_date: string
      ball: string
      due_authority_connection_id: string | null
    }
    return {
      id: r.id,
      title: r.title,
      dueDate: r.due_date,
      ball: r.ball === 'client' ? 'client' : 'internal',
      dueAuthorityConnectionId: r.due_authority_connection_id,
    }
  })
}

// ---------------------------------------------------------------------------
// sender: claim / finalize（PR-0のRPCをそのまま呼ぶ。新規RPCは作らない）
// ---------------------------------------------------------------------------

export interface DueReminderOccurrenceRow {
  id: string
  taskId: string
  kind: 'due_soon' | 'due_today' | 'overdue_confirm'
  offsetMinutes: number
  dueSnapshot: string
  sendCount: number
}

/**
 * rpc_claim_due_reminder_occurrences（PR-0 migration）をそのまま呼ぶ。
 * for update skip locked ＋ lease 10分で最大 limit 件を claim する。
 */
export async function claimDueReminderOccurrences(
  limit: number,
  now: Date,
): Promise<DueReminderOccurrenceRow[]> {
  const { data, error } = await admin().rpc('rpc_claim_due_reminder_occurrences', {
    p_limit: limit,
    // 絶対時刻の引き渡し（日付成分抽出ではないので toISOString で正しい）
    p_now: now.toISOString(),
  })
  if (error) throw new Error(`rpc_claim_due_reminder_occurrences failed: ${error.message}`)

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    taskId: row.task_id as string,
    kind: row.kind as 'due_soon' | 'due_today' | 'overdue_confirm',
    offsetMinutes: row.offset_minutes as number,
    dueSnapshot: row.due_snapshot as string,
    sendCount: row.send_count as number,
  }))
}

export type DueReminderFinalizeOutcome = 'sent' | 'suppressed' | 'deferred'

/** rpc_finalize_due_reminder_occurrence（PR-0 migration）をそのまま呼ぶ。 */
export async function finalizeDueReminderOccurrence(
  id: string,
  outcome: DueReminderFinalizeOutcome,
  reason?: string,
): Promise<void> {
  const { error } = await admin().rpc('rpc_finalize_due_reminder_occurrence', {
    p_id: id,
    p_outcome: outcome,
    p_reason: reason ?? null,
  })
  if (error) throw new Error(`rpc_finalize_due_reminder_occurrence failed: ${error.message}`)
}

/** 複数接続の鮮度情報を1クエリでまとめて引く（digestの期限セクション用）。 */
export async function findConnectionFreshnessBatch(
  connectionIds: string[],
): Promise<Map<string, DueAuthorityConnectionInfo>> {
  const unique = [...new Set(connectionIds)]
  if (unique.length === 0) return new Map()

  const { data, error } = await admin()
    .from('integration_connections')
    .select('id, status, provider, last_import_success_at, import_missing_containers')
    .in('id', unique)

  if (error) throw new Error(`integration_connections: batch freshness lookup failed: ${error.message}`)

  const map = new Map<string, DueAuthorityConnectionInfo>()
  for (const row of data ?? []) {
    const r = row as {
      id: string
      status: string
      provider: string
      last_import_success_at: string | null
      import_missing_containers: Record<string, string> | null
    }
    map.set(r.id, {
      status: r.status,
      provider: r.provider,
      lastImportSuccessAt: r.last_import_success_at,
      importMissingContainers: r.import_missing_containers ?? {},
    })
  }
  return map
}

// ---------------------------------------------------------------------------
// 完了確認ループ（PR-2・§7）: LINE経路の完了確認/スヌーズ。
// digestのpromote/reject（rpc_promote_digest_task_via_line等）と同型 — authz（口座束縛・
// テナント一致）とsingle-winner遷移・監査・connector complete enqueueはRPCが1トランザクション
// で完結させる。ここではRPCを呼ぶだけで、migration/RPC定義自体は本PRのスコープ外
// （別PRで導入済みの rpc_confirm_task_done_via_line / rpc_snooze_due_reminder_via_line を叩く）。
// ---------------------------------------------------------------------------

export type DueReminderConfirmStatus = 'done' | 'already_done' | 'forbidden' | 'blocked'
/**
 * already_snoozed（code review #2是正）: 世代不一致（呼び出し側が渡したexpectedSendCountが
 * occurrence.send_countと一致しない）＝旧世代Flexの再送信・再タップ。既に処理済みの正当な
 * 無操作として扱う（forbidden/not_foundと同様、handler側は#5方針により沈黙する）。
 */
export type DueReminderSnoozeStatus = 'snoozed' | 'capped' | 'forbidden' | 'not_found' | 'already_snoozed'

/**
 * LINE経路の完了確認。channelAccountId/externalUserId はwebhook検証済みの値のみ渡す
 * （client供給のp_actor等は受けない・authzはRPC内で完結）。
 */
export async function confirmTaskDoneViaLine(
  channelAccountId: string,
  externalUserId: string,
  taskId: string,
): Promise<{ status: DueReminderConfirmStatus }> {
  const { data, error } = await admin().rpc('rpc_confirm_task_done_via_line', {
    p_channel_account_id: channelAccountId,
    p_external_user_id: externalUserId,
    p_task_id: taskId,
  })
  if (error) throw new Error(`rpc_confirm_task_done_via_line failed: ${error.message}`)
  const row = Array.isArray(data) ? data[0] : data
  return { status: (row?.status ?? 'forbidden') as DueReminderConfirmStatus }
}

/**
 * LINE経路のスヌーズ（[まだ]/[○日後に再通知]、いずれも同一RPC呼び出し）。
 * expectedSendCount（code review #2是正）: postback発行時点のoccurrence.send_count（世代）を
 * そのまま渡す。RPCがp_expected_send_countと現在のsend_countを比較し、不一致なら
 * already_snoozed（旧世代Flexのリプレイ防止）を返す。
 */
export async function snoozeDueReminderViaLine(
  channelAccountId: string,
  externalUserId: string,
  occurrenceId: string,
  snoozeDays: number,
  expectedSendCount: number,
): Promise<{ status: DueReminderSnoozeStatus }> {
  const { data, error } = await admin().rpc('rpc_snooze_due_reminder_via_line', {
    p_channel_account_id: channelAccountId,
    p_external_user_id: externalUserId,
    p_occurrence_id: occurrenceId,
    p_snooze_days: snoozeDays,
    p_expected_send_count: expectedSendCount,
  })
  if (error) throw new Error(`rpc_snooze_due_reminder_via_line failed: ${error.message}`)
  const row = Array.isArray(data) ? data[0] : data
  return { status: (row?.status ?? 'not_found') as DueReminderSnoozeStatus }
}
