import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'
import { getValidTokenDetailed } from '@/lib/integrations/token-manager'
import { refreshAccessToken } from '@/lib/google-calendar/client'
import { patchTask } from '@/lib/google-tasks/client'
import { sendIssueUpsert, sendIssueCancel, type MulticaConnection } from './multica/client'
import { getTaskSyncAdapter } from '@/lib/task-sync/adapters'
import { resolveCredentials } from '@/lib/task-sync/credentials'
import type { ProviderContext, TaskSyncAdapter } from '@/lib/task-sync/types'

/**
 * 汎用コネクタ送信ディスパッチャ(TaskApp → 外部)。connector_jobs(アウトボックス)を
 * claim して接続の provider ごとに配達する。src/lib/google-tasks/mirror.ts の
 * dispatchTaskMirrorBatch と同型(claim → 接続ごとにグループ → 処理 → complete で確定)。
 *
 * provider 別の扱い:
 *   - multica: op='upsert'/'cancel' を multica API に送る(issue.upsert / issue.cancel)。
 *     upsert 成功時は返却された issue_id を connector_task_links に保存する。
 *   - タスク同期アダプタを持つ provider(Backlog/Jooto/Jira/Redmine/Asana/Trello/Linear):
 *     op='complete' をアダプタの completeTask で外部へ書き戻す。これが無いとカタログが
 *     completionWrite=true と宣言しているのにジョブが即 dead になり、「TaskAppで完了しても
 *     外部ツールに反映されない」片翼だけの同期になる。
 *   - google_tasks: op='complete' のみ処理する(multica 完了 → gtasks 完了の書き戻し)。
 *     gtasks は取り込み専用(import.ts)であり、TaskApp からの起票/更新を押し戻すことはしない
 *     ため op='upsert'/'cancel' は no-op(契約: gtasksが正本のタスクは gtasks 側でしか作成/削除されない)。
 *
 * エラー分類: mirror.ts の classifyError を踏襲(400/404/422=permanent_fail、それ以外=temporary_fail)。
 * gtasks 404(相手が既に消えている)は「完了と同義」として done 扱いにする(mirror.ts の complete と同じ)。
 */

let _admin: SupabaseClient | null = null
function admin(): SupabaseClient {
  if (!_admin) {
    _admin = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _admin
}

interface ConnectorJob {
  id: string
  connection_id: string
  task_id: string
  op: 'upsert' | 'cancel' | 'complete'
  payload: Record<string, unknown>
  attempt: number
  version: number
  leased_until: string | null
  // 72h defer キャップの基準(rpc_claim_connector_jobs は j.* を返すため常に含まれる)。
  created_at?: string | null
}

/**
 * defer(インフラ一時障害で attempt を消費しない)の経過時間キャップ。
 * connector_jobs には sink の 20連続自動停止に相当する circuit breaker が無いため、無限 defer を
 * 防ぐ歯止めをコード側に置く(Fable 裁定 2026-07-23)。job の created_at から 72h を超えた defer 対象は
 * temporary_fail に降格し、従来のバックオフ予算消費(最終的に dead へ収束)に戻す。
 */
const INFRA_DEFER_MAX_AGE_MS = 72 * 60 * 60 * 1000

/**
 * インフラ一時障害の完了 outcome を決める。72h 以内なら defer(attempt 不変)、超過なら
 * temporary_fail に降格する(無限ループ防止=最終的に dead へ収束)。created_at が無い異常時も
 * 安全側で temporary_fail(予算消費)にし、defer で寝かせ続けない。
 */
function infraTransientOutcome(job: ConnectorJob, now: number): 'defer' | 'temporary_fail' {
  if (!job.created_at) return 'temporary_fail'
  const createdMs = new Date(job.created_at).getTime()
  if (Number.isNaN(createdMs)) return 'temporary_fail'
  return now - createdMs > INFRA_DEFER_MAX_AGE_MS ? 'temporary_fail' : 'defer'
}

interface ConnectionRow {
  id: string
  provider: string
  status?: string
  metadata: Record<string, unknown> | null
  // タスク同期アダプタ経由の書き戻しに要る列（gtasks/multica では使わない）。
  auth_kind?: 'oauth' | 'api_key' | 'shared_secret' | null
  base_url?: string | null
  access_token_encrypted?: string | null
  import_config?: Record<string, unknown> | null
}

export interface ConnectorDispatchSummary {
  claimed: number
  done: number
  tempFailed: number
  dead: number
  // 自分側インフラの一時障害で attempt を消費せず defer(5分後再試行)した件数。
  deferred: number
}

/**
 * 400/404/422 は恒久失敗(毒)。それ以外(401/403/5xx/ネットワーク/status無し)は一時失敗として再試行に回す。
 *
 * ⚠ アダプタが明示した `permanent`(ProviderError.permanent。src/lib/task-sync/types.ts)を最優先する。
 *   以前は HTTP status だけで分類しており、アダプタ側の判断(例: kintoneの GAIA_NO01=権限不足は
 *   恒久だが status=403 で判定漏れ／GAIA_UN03=同時編集競合は一時失敗にしたいが status=409 に
 *   `permanent`未設定だと分類が status 頼みで不安定、といった不整合)が dispatch 側で握り潰されていた。
 *   `permanent` が明示されていればそれに従い、未指定(undefined)のときだけ従来通り status
 *   フォールバックを使う。
 */
function classifyError(err: unknown): 'permanent_fail' | 'temporary_fail' {
  const permanent = (err as { permanent?: boolean } | undefined)?.permanent
  if (permanent === true) return 'permanent_fail'
  if (permanent === false) return 'temporary_fail'
  const status = (err as { status?: number } | undefined)?.status
  if (status === 400 || status === 404 || status === 422) return 'permanent_fail'
  return 'temporary_fail'
}

function isNotFound(err: unknown): boolean {
  return (err as { status?: number } | undefined)?.status === 404
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function completeJob(job: ConnectorJob, outcome: string, error?: string): Promise<void> {
  // p_version を渡す。処理中に fold されて version が進んでいれば、RPC 側が done/dead を書かず
  // lease だけ解いて最新 op を pending のまま残す(古い結果で最新の意図を潰さない)。
  const { error: rpcError } = await admin().rpc('rpc_complete_connector_job', {
    p_job_id: job.id,
    p_version: job.version,
    p_outcome: outcome,
    p_error: error ?? null,
  })
  if (rpcError) throw new Error(`rpc_complete_connector_job failed: ${rpcError.message}`)
}

/** multica upsert 成功で返る issue_id を connector_task_links(origin=external) へ保存する。 */
async function saveMulticaLink(connectionId: string, taskId: string, issueId: string): Promise<void> {
  const { error } = await admin()
    .from('connector_task_links')
    .upsert(
      {
        connection_id: connectionId,
        task_id: taskId,
        external_id: issueId,
        origin: 'external',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'connection_id,task_id' },
    )
  if (error) throw new Error(`connector_task_links upsert failed: ${error.message}`)
}

async function processMulticaJob(job: ConnectorJob, conn: MulticaConnection): Promise<void> {
  if (job.op === 'upsert') {
    const p = job.payload
    const result = await sendIssueUpsert(conn, {
      taskRef: job.task_id,
      title: typeof p.title === 'string' ? p.title : '(無題)',
      body: typeof p.body === 'string' ? p.body : null,
      status: p.status === 'in_progress' ? 'in_progress' : 'todo',
      dueDate: typeof p.due_date === 'string' ? p.due_date : null,
      assigneeHint: typeof p.assignee_hint === 'string' ? p.assignee_hint : null,
      origin: p.origin === 'internal' ? 'internal' : 'external',
    })
    await saveMulticaLink(job.connection_id, job.task_id, result.issueId)
    return
  }
  if (job.op === 'cancel') {
    await sendIssueCancel(conn, job.task_id)
    return
  }
  // op === 'complete' は multica 向けには発生しない想定(multica → TaskApp の完了はWebhook受信で処理)。
  // 想定外の混入は安全側でno-op(何もしないままdoneにする。無限リトライさせない)。
}

/** connector_task_links から gtasks 側の external_id/external_list_id を引く(op=complete の書き戻し先)。 */
async function loadGoogleTasksLink(
  connectionId: string,
  taskId: string,
): Promise<{ externalId: string; externalListId: string | null } | null> {
  const { data, error } = await admin()
    .from('connector_task_links')
    .select('external_id, external_list_id')
    .eq('connection_id', connectionId)
    .eq('task_id', taskId)
    .maybeSingle()
  if (error) throw new Error(`connector_task_links lookup failed: ${error.message}`)
  const row = data as { external_id: string; external_list_id: string | null } | null
  return row ? { externalId: row.external_id, externalListId: row.external_list_id } : null
}

async function processGoogleTasksJob(job: ConnectorJob, token: string): Promise<void> {
  if (job.op !== 'complete') {
    // gtasks は取り込み専用(import.ts)。TaskApp からの起票/更新(upsert)や対象外化(cancel)を
    // gtasks 側へ押し戻すことはしない契約のため no-op(ジョブは done として消化する)。
    return
  }
  const link = await loadGoogleTasksLink(job.connection_id, job.task_id)
  if (!link || !link.externalListId) {
    // 書き戻し先が無い(link未存在/リストID欠落)。設定不整合であり無限リトライしても解決しないため恒久失敗にする。
    const err = new Error('connector_task_links missing for gtasks complete') as Error & { status?: number }
    err.status = 404
    throw err
  }
  try {
    await patchTask(token, link.externalListId, link.externalId, { status: 'completed' })
  } catch (err) {
    // 完了させたい相手(Google側タスク)が既に消えている(404)なら「完了」と同義として done 扱いにする。
    if (isNotFound(err)) return
    throw err
  }
}

async function processConnectionJobs(
  conn: ConnectionRow,
  jobs: ConnectorJob[],
  summary: ConnectorDispatchSummary,
): Promise<void> {
  const runnable = jobs.filter((j) => {
    // 処理直前の lease チェック: 長時間バッチで lease(10分)が切れていたら、この行は既に別 worker が
    // 再取得しうる。complete を呼ばずスキップし、二重確定の窓を局所化する(次サイクルで拾い直す)。
    return !(j.leased_until && new Date(j.leased_until).getTime() <= Date.now())
  })
  if (runnable.length === 0) return

  if (conn.provider === 'multica') {
    const multicaConn: MulticaConnection = { id: conn.id, metadata: conn.metadata }
    for (const j of runnable) {
      try {
        await processMulticaJob(j, multicaConn)
        await completeJob(j, 'done')
        summary.done++
      } catch (err) {
        const outcome = classifyError(err)
        await completeJob(j, outcome, errMessage(err))
        if (outcome === 'permanent_fail') summary.dead++
        else summary.tempFailed++
      }
    }
    return
  }

  if (conn.provider === 'google_tasks') {
    const tok = await getValidTokenDetailed(conn.id, refreshAccessToken)
    if (tok.status !== 'ok') {
      // 失効(auth_failed)は token-manager が connection を expired 化済み。一時失敗で寝かせ、
      // 再接続後に再試行させる(毒にはしない)。
      // defer 強化(Fable 裁定 2026-07-23): **自分側インフラ**由来の一時障害(接続行復号/DB read の瞬断=
      // transientKind 不在)は attempt を消費せず defer(72h キャップ超は temporary_fail に降格)。
      // 外部refresh起因(transientKind='refresh')・失効(auth_failed)は従来どおり temporary_fail。
      const isInfraTransient = tok.status === 'transient_error' && tok.transientKind !== 'refresh'
      const now = Date.now()
      for (const j of runnable) {
        const outcome = isInfraTransient ? infraTransientOutcome(j, now) : 'temporary_fail'
        await completeJob(j, outcome, `token_${tok.status}`)
        if (outcome === 'defer') summary.deferred++
        else summary.tempFailed++
      }
      return
    }
    for (const j of runnable) {
      try {
        await processGoogleTasksJob(j, tok.token)
        await completeJob(j, 'done')
        summary.done++
      } catch (err) {
        const outcome = classifyError(err)
        await completeJob(j, outcome, errMessage(err))
        if (outcome === 'permanent_fail') summary.dead++
        else summary.tempFailed++
      }
    }
    return
  }

  // タスク同期アダプタを持つ provider(Backlog/Jooto/Jira/Redmine/Asana/Trello/Linear)。
  // TaskApp 側で完了したタスクを外部へ書き戻す(op='complete')。
  const adapter = getTaskSyncAdapter(conn.provider)
  if (adapter) {
    await processTaskSyncJobs(conn, adapter, runnable, summary)
    return
  }

  // 未対応provider(将来の拡張漏れ/データ不整合)。無限リトライさせず恒久失敗として dead 化する。
  for (const j of runnable) {
    await completeJob(j, 'permanent_fail', `unsupported_provider:${conn.provider}`)
    summary.dead++
  }
}

/**
 * タスク同期アダプタ経由の配達。現状 op='complete' のみ（取り込み専用＝TaskAppからの起票/更新を
 * 外部へ押し出す契約は multica だけが持つ）。
 *
 * これが無いと、カタログが completionWrite=true と宣言しているのに完了ジョブが
 * unsupported_provider で即 dead になり、「TaskApp で完了しても外部ツールに反映されない」
 * 片翼だけの同期になる。
 */
async function processTaskSyncJobs(
  conn: ConnectionRow,
  adapter: TaskSyncAdapter,
  jobs: ConnectorJob[],
  summary: ConnectorDispatchSummary,
): Promise<void> {
  if (conn.status && conn.status !== 'active') {
    // 失効・無効化済みの接続で外部を叩かない（鍵を復号して無効な接続先へ送らない）。
    // 再接続で直るため毒にはせず一時失敗で寝かせる。
    for (const j of jobs) await completeJob(j, 'temporary_fail', `connection_${conn.status}`)
    summary.tempFailed += jobs.length
    return
  }

  const cred = await resolveCredentials({
    id: conn.id,
    auth_kind: conn.auth_kind ?? 'api_key',
    base_url: conn.base_url ?? null,
    access_token_encrypted: conn.access_token_encrypted ?? null,
  })
  if (cred.status !== 'ok') {
    // 設定不備だけは恒久失敗にして、直らないものを永久に再試行し続けないようにする。
    if (cred.status === 'misconfigured') {
      for (const j of jobs) await completeJob(j, 'permanent_fail', `credentials_${cred.status}`)
      summary.dead += jobs.length
      return
    }
    // 失効(auth_failed)・一時障害(transient_error)は毒にしない(再接続/次サイクルで直る)。
    // defer 強化(Fable 裁定 2026-07-23): **自分側インフラ**由来の一時障害(トークン復号RPC/DB read の
    // 瞬断=transientKind 不在)は attempt を消費せず defer(72h キャップ超は temporary_fail に降格)。
    // 外部refresh起因(transientKind='refresh')・失効(auth_failed)は従来どおり temporary_fail。
    const isInfraTransient = cred.status === 'transient_error' && cred.transientKind !== 'refresh'
    const now = Date.now()
    for (const j of jobs) {
      const outcome = isInfraTransient ? infraTransientOutcome(j, now) : 'temporary_fail'
      await completeJob(j, outcome, `credentials_${cred.status}`)
      if (outcome === 'defer') summary.deferred++
      else summary.tempFailed++
    }
    return
  }

  const ctx: ProviderContext = {
    credentials: cred.credentials,
    config: providerConfigOf(conn.import_config, conn.provider),
  }

  for (const j of jobs) {
    if (j.op !== 'complete') {
      // 取り込み専用のため upsert/cancel は押し戻さない（gtasks と同じ契約）。ジョブは消化する。
      await completeJob(j, 'done')
      summary.done++
      continue
    }
    try {
      const link = await loadTaskSyncLink(j.connection_id, j.task_id)
      if (!link || !link.containerId) {
        // 書き戻し先が無い（対応が無い／入れ物IDが欠落）。空文字で代用すると、入れ物IDを実際に
        // 使うツール（Linear のチーム、Jooto のURL）へ不正なIDで投げることになり、失敗の原因が
        // 分からなくなる。設定不整合であり再試行では解決しないため恒久失敗にする。
        await completeJob(j, 'permanent_fail', 'connector_task_links missing or has no container')
        summary.dead++
        continue
      }
      await adapter.completeTask(ctx, { externalId: link.externalId, containerId: link.containerId })
      await completeJob(j, 'done')
      summary.done++
    } catch (err) {
      // 完了させたい相手が既に消えている(404)なら「完了」と同義として done 扱いにする。
      if (isNotFound(err)) {
        await completeJob(j, 'done')
        summary.done++
        continue
      }
      const outcome = classifyError(err)
      await completeJob(j, outcome, errMessage(err))
      if (outcome === 'permanent_fail') summary.dead++
      else summary.tempFailed++
    }
  }
}

/** 書き戻し先の外部ID/コンテナIDを対応表から引く。 */
async function loadTaskSyncLink(
  connectionId: string,
  taskId: string,
): Promise<{ externalId: string; containerId: string | null } | null> {
  const { data, error } = await admin()
    .from('connector_task_links')
    .select('external_id, external_list_id')
    .eq('connection_id', connectionId)
    .eq('task_id', taskId)
    .maybeSingle()
  if (error) throw new Error(`connector_task_links lookup failed: ${error.message}`)
  const row = data as { external_id: string; external_list_id: string | null } | null
  return row ? { externalId: row.external_id, containerId: row.external_list_id } : null
}

/** provider 固有設定（`<provider>_` 接頭辞）だけをアダプタへ渡す（他ツールの設定を混ぜない）。 */
function providerConfigOf(
  importConfig: Record<string, unknown> | null | undefined,
  provider: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(importConfig ?? {})) {
    if (key.startsWith(`${provider}_`)) out[key] = value
  }
  return out
}

/** 接続情報(provider/metadata)をまとめて取得する。1バッチにつき1回だけ叩く。 */
async function loadConnections(connectionIds: string[]): Promise<Map<string, ConnectionRow>> {
  const { data, error } = await admin()
    .from('integration_connections')
    .select('id, provider, status, metadata, auth_kind, base_url, access_token_encrypted, import_config')
    .in('id', connectionIds)
  if (error) throw new Error(`integration_connections lookup failed: ${error.message}`)
  const map = new Map<string, ConnectionRow>()
  for (const row of (data as ConnectionRow[] | null) ?? []) {
    map.set(row.id, row)
  }
  return map
}

/** コネクタ送信ジョブを1バッチ処理する。cron 起動配線は後続PR(このワーカーは呼び出されるだけ)。 */
export async function dispatchConnectorJobsBatch(limit = 100): Promise<ConnectorDispatchSummary> {
  const summary: ConnectorDispatchSummary = { claimed: 0, done: 0, tempFailed: 0, dead: 0, deferred: 0 }

  const { data: jobs, error } = await admin().rpc('rpc_claim_connector_jobs', { p_total_limit: limit })
  if (error) {
    console.error('[connector-dispatch] claim failed:', error)
    return summary
  }
  const list = (jobs as ConnectorJob[] | null) ?? []
  summary.claimed = list.length
  if (list.length === 0) return summary

  const byConn = new Map<string, ConnectorJob[]>()
  for (const j of list) {
    const arr = byConn.get(j.connection_id) ?? []
    arr.push(j)
    byConn.set(j.connection_id, arr)
  }

  const connMap = await loadConnections([...byConn.keys()])

  for (const [connId, connJobs] of byConn) {
    const conn = connMap.get(connId)
    if (!conn) {
      // 接続が消えている(削除済み)。書き戻し先が存在しないため恒久失敗にする。
      for (const j of connJobs) await completeJob(j, 'permanent_fail', 'connection_not_found')
      summary.dead += connJobs.length
      continue
    }
    await processConnectionJobs(conn, connJobs, summary)
  }
  return summary
}
