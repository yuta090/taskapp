import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'
import { getValidTokenDetailed } from '@/lib/integrations/token-manager'
import { refreshAccessToken } from '@/lib/google-calendar/client'
import { patchTask } from '@/lib/google-tasks/client'
import { sendIssueUpsert, sendIssueCancel, type MulticaConnection } from './multica/client'
import { getTaskSyncAdapter } from '@/lib/task-sync/adapters'
import { resolveCredentials } from '@/lib/task-sync/credentials'
import { infraTransientError, isInfraTransientError } from '@/lib/connectors/infraTransient'
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
 * temporary_fail に降格する(無限ループ防止=最終的に dead へ収束)。
 *
 * 【age の基準は created_at(最初の enqueue 時刻)】connector_jobs は (connection,task) 単位で pending を
 *   1件に fold する(enqueue.ts)。fold は op/payload/version/next_attempt_at/updated_at を更新するが
 *   **created_at は据え置く**。よって created_at は「この配達チャネルが最初に詰まってから経過した総時間」
 *   を表す。あえて updated_at(最新 op 時刻)を使わないのは、そうすると task が繰り返し更新される限り
 *   時計がリセットされ、長期インフラ障害中に無限 defer し得る(72h キャップが無力化する)ため。
 *   fold で新しい op が古い created_at を継ぐのは意図どおり(チャネル単位の総詰まり時間で頭打ちにする)。
 *
 * 【異常な created_at の方針(安全側を明示)】
 *   - 無い / パース不能(NaN): age を確定できない → temporary_fail(予算消費)。defer で寝かせ続けない。
 *   - 未来 / たった今 enqueue(now - created < 0): 「若いジョブ」とみなし defer(attempt を温存)。軽微な
 *     クロックスキューを temporary_fail にしないため。負値は 72h キャップに掛からず defer になる。
 *   - ちょうど 72h(now - created === MAX): 境界は defer(> MAX で初めて temporary_fail)。
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
  // 対応表(自分側DB)の read は外部送信より前の**自分側**処理。read 自体の失敗(DB瞬断)は infra 一時障害
  // として投げ、dispatch が attempt 不変の defer に回す(row 不在=null は別: 書き戻し先未設定=恒久失敗)。
  if (error) throw infraTransientError(`connector_task_links lookup failed: ${error.message}`)
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
    const now = Date.now()
    for (const j of runnable) {
      try {
        await processMulticaJob(j, multicaConn)
        await completeJob(j, 'done')
        summary.done++
      } catch (err) {
        // 外部送信より前の**自分側**インフラ一時障害(send_secret 復号RPC/vault の瞬断)は attempt を
        // 消費せず defer(72h キャップ超は temporary_fail)。send_secret の恒久破損(422)や multica API
        // 応答(400/404/422/5xx)は従来どおり classifyError で扱う(配達先起因を defer に流さない)。
        if (isInfraTransientError(err)) {
          const outcome = infraTransientOutcome(j, now)
          await completeJob(j, outcome, errMessage(err))
          if (outcome === 'defer') summary.deferred++
          else summary.tempFailed++
          continue
        }
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
    const now = Date.now()
    for (const j of runnable) {
      try {
        await processGoogleTasksJob(j, tok.token)
        await completeJob(j, 'done')
        summary.done++
      } catch (err) {
        // link read(connector_task_links)の DB 瞬断など**外部送信より前の自分側**インフラ一時障害は
        // attempt を消費せず defer(72h キャップ)。link 不在(書き戻し先未設定=404)や gtasks API の失敗は
        // 従来どおり classifyError(配達先起因を defer に流さない)。
        if (isInfraTransientError(err)) {
          const outcome = infraTransientOutcome(j, now)
          await completeJob(j, outcome, errMessage(err))
          if (outcome === 'defer') summary.deferred++
          else summary.tempFailed++
          continue
        }
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

  const now = Date.now()
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
      // link read(connector_task_links)の DB 瞬断など**外部送信より前の自分側**インフラ一時障害は
      // attempt を消費せず defer(72h キャップ)。link 不在(書き戻し先未設定)は上の分岐で恒久失敗済み。
      if (isInfraTransientError(err)) {
        const outcome = infraTransientOutcome(j, now)
        await completeJob(j, outcome, errMessage(err))
        if (outcome === 'defer') summary.deferred++
        else summary.tempFailed++
        continue
      }
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
  // loadGoogleTasksLink と同じ: DB read 自体の失敗は infra 一時障害として投げ defer に回す
  // (row 不在=null は呼び出し側で恒久失敗=書き戻し先未設定として扱う)。
  if (error) throw infraTransientError(`connector_task_links lookup failed: ${error.message}`)
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

/**
 * 接続情報(provider/metadata)をまとめて取得する。1バッチにつき1回だけ叩く。
 *
 * ⚠ DB error では **throw しない**。throw するとバッチ全体(dispatchConnectorJobsBatch)が中断し、
 * claim 済み(lease 済み)のジョブが completion RPC を通らないまま lease 失効 → 次サイクルで無限に
 * 再 claim され、attempt が進まず 72h キャップも迂回される(Codex 指摘 Critical1)。代わりに
 * `dbError` フラグを返し、呼び出し側が claim 済み全ジョブを infra 一時障害として completion に通す。
 *
 * dbError(=接続行が「取得できない」自分側DBの瞬断)と、取得成功だが row 不在(=削除済み)は**別物**:
 *   - dbError=true          → 呼び出し側で infra defer(72hキャップ)。
 *   - dbError=false・row 不在 → 呼び出し側で permanent_fail(connection_not_found)。
 */
async function loadConnections(
  connectionIds: string[],
): Promise<{ connections: Map<string, ConnectionRow>; dbError: boolean }> {
  const map = new Map<string, ConnectionRow>()
  const { data, error } = await admin()
    .from('integration_connections')
    .select('id, provider, status, metadata, auth_kind, base_url, access_token_encrypted, import_config')
    .in('id', connectionIds)
  if (error) {
    console.error('[connector-dispatch] integration_connections lookup failed:', error)
    return { connections: map, dbError: true }
  }
  for (const row of (data as ConnectionRow[] | null) ?? []) {
    map.set(row.id, row)
  }
  return { connections: map, dbError: false }
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

  const { connections: connMap, dbError: connLoadError } = await loadConnections([...byConn.keys()])
  const now = Date.now()

  for (const [connId, connJobs] of byConn) {
    if (connLoadError) {
      // 接続行が「取得できない」=自分側DBの瞬断(Codex 指摘 Critical1)。配達を試みる前の自分側障害
      // なので attempt を消費せず defer(72h キャップ超は temporary_fail に降格)。バッチは落とさない。
      for (const j of connJobs) {
        const outcome = infraTransientOutcome(j, now)
        await completeJob(j, outcome, 'integration_connections_lookup_failed')
        if (outcome === 'defer') summary.deferred++
        else summary.tempFailed++
      }
      continue
    }
    const conn = connMap.get(connId)
    if (!conn) {
      // loadConnections 成功で該当 row が無い=接続が削除済み。書き戻し先が存在しないため恒久失敗。
      // (DB error と違い、これは「無い」ことが確定しているので defer しない。)
      for (const j of connJobs) await completeJob(j, 'permanent_fail', 'connection_not_found')
      summary.dead += connJobs.length
      continue
    }
    try {
      await processConnectionJobs(conn, connJobs, summary)
    } catch (err) {
      // 1接続の処理が想定外に throw しても**バッチ全体を落とさない**(他接続の claim 済みジョブを
      // orphan にしない)。Critical1 と同型: ここで throw が抜けると、この接続の claim 済みジョブが
      // completion RPC を通らず lease 失効 → 無限再 claim になり、後続の接続も処理されない。
      // 想定外 throw の主因は completion RPC(rpc_complete_connector_job)自体の瞬断など自分側インフラ
      // なので、この接続のジョブを infra 一時障害として defer(72h キャップ)に通す。
      // completion RPC が続けて落ちる場合は次サイクルで再度ここに来る(at-least-once + 冪等で吸収)。
      console.error('[connector-dispatch] connection batch failed, defer-ing its jobs:', connId, err)
      for (const j of connJobs) {
        try {
          const outcome = infraTransientOutcome(j, now)
          await completeJob(j, outcome, 'connection_batch_infra_error')
          if (outcome === 'defer') summary.deferred++
          else summary.tempFailed++
        } catch (completeErr) {
          // completion 自体が落ちるなら lease 失効で次サイクルに回す(消せるものが無い)。
          console.error('[connector-dispatch] defer completion also failed:', j.id, completeErr)
        }
      }
    }
  }
  return summary
}
