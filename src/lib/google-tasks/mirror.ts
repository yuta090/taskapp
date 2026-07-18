import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'
import { getValidTokenDetailed } from '@/lib/integrations/token-manager'
import { refreshAccessToken } from '@/lib/google-calendar/client'
import { GOOGLE_TASKS_LIST_TITLE } from './config'
import {
  ensureTaskList,
  insertTask,
  patchTask,
  deleteTask,
  dateToGoogleDue,
  type TaskWriteFields,
} from './client'

/**
 * 順方向ミラーワーカー: user_task_mirror_jobs を claim して Google Tasks へ反映する。
 *
 * op:
 *   - upsert:   ref があれば patch、無ければ insert して ref を保存(タスク作成/更新)
 *   - complete: payload.google_task_id を status=completed に patch(TaskApp done → Google 完了)
 *   - delete:   payload.google_task_id を delete して ref を掃除(担当替え/対象外化/タスク削除)
 *
 * 失敗分類: 400/404/422 は毒(permanent_fail=dead)、401/403 とその他は temporary_fail(バックオフ再試行)。
 * トークン失効は token-manager が connection を expired 化するので、ここでは temporary_fail に倒す。
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

interface MirrorJob {
  id: string
  connection_id: string
  task_id: string
  op: 'upsert' | 'complete' | 'delete'
  payload: Record<string, unknown>
  attempt: number
  version: number
  leased_until: string | null
}

export interface MirrorSummary {
  claimed: number
  done: number
  tempFailed: number
  dead: number
}

/** 400/404/422 は恒久失敗(毒)。それ以外(401/403/5xx/ネットワーク)は一時失敗として再試行に回す。 */
function classifyError(err: unknown): 'permanent_fail' | 'temporary_fail' {
  const status = (err as { status?: number } | undefined)?.status
  if (status === 400 || status === 404 || status === 422) return 'permanent_fail'
  return 'temporary_fail'
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function completeJob(job: MirrorJob, outcome: string, error?: string): Promise<void> {
  // p_version を渡す。処理中に fold されて version が進んでいれば、RPC 側が done/dead を書かず
  // lease だけ解いて最新 op を pending のまま残す（古い結果で最新の意図を潰さない）。
  const { error: rpcError } = await admin().rpc('rpc_complete_task_mirror_job', {
    p_job_id: job.id,
    p_version: job.version,
    p_outcome: outcome,
    p_error: error ?? null,
  })
  if (rpcError) throw new Error(`rpc_complete_task_mirror_job failed: ${rpcError.message}`)
}

/** 接続の metadata から tasklist_id を得る。無ければ ensureTaskList で確保し metadata に保存する。 */
async function resolveTasklistId(connectionId: string, token: string): Promise<string> {
  const { data: conn, error: selErr } = await admin()
    .from('integration_connections')
    .select('metadata')
    .eq('id', connectionId)
    .single()
  if (selErr) throw new Error(`resolveTasklistId select failed: ${selErr.message}`)
  const metadata = (conn?.metadata as Record<string, unknown> | null) ?? {}
  const existing = metadata.tasklist_id
  if (typeof existing === 'string' && existing) return existing

  const tasklistId = await ensureTaskList(token, GOOGLE_TASKS_LIST_TITLE)
  // NOTE(フォローアップ): metadata は read-modify-write のため poll_cursor 更新と競合し
  // 相互に上書きしうる。消えても tasklist_id は再解決・poll_cursor は再ポーリングで自己修復するため
  // 今回は据え置き（fable 判断）。恒久対応は metadata の部分更新 or 専用列化。
  const { error: updErr } = await admin()
    .from('integration_connections')
    .update({ metadata: { ...metadata, tasklist_id: tasklistId } })
    .eq('id', connectionId)
  if (updErr) throw new Error(`resolveTasklistId update failed: ${updErr.message}`)
  return tasklistId
}

async function getRef(
  connectionId: string,
  taskId: string,
): Promise<{ google_task_id: string; google_tasklist_id: string } | null> {
  const { data, error } = await admin()
    .from('user_task_mirror_refs')
    .select('google_task_id, google_tasklist_id')
    .eq('connection_id', connectionId)
    .eq('task_id', taskId)
    .maybeSingle()
  // DBエラーを ref=null と誤認すると upsert が再 insert して Google タスクを二重作成する。必ず throw。
  if (error) throw new Error(`getRef failed: ${error.message}`)
  return (data as { google_task_id: string; google_tasklist_id: string } | null) ?? null
}

async function saveRef(
  connectionId: string,
  taskId: string,
  tasklistId: string,
  googleTaskId: string,
): Promise<void> {
  const { error } = await admin()
    .from('user_task_mirror_refs')
    .upsert(
      {
        connection_id: connectionId,
        task_id: taskId,
        google_tasklist_id: tasklistId,
        google_task_id: googleTaskId,
        state: 'active',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'connection_id,task_id' },
    )
  if (error) throw new Error(`saveRef failed: ${error.message}`)
}

async function deleteRef(connectionId: string, taskId: string): Promise<void> {
  const { error } = await admin()
    .from('user_task_mirror_refs')
    .delete()
    .eq('connection_id', connectionId)
    .eq('task_id', taskId)
  if (error) throw new Error(`deleteRef failed: ${error.message}`)
}

function isNotFound(err: unknown): boolean {
  return (err as { status?: number } | undefined)?.status === 404
}

/** Google タスクを作成して ref を保存する。ref 保存失敗時は作成分を補償 delete して rethrow。 */
async function insertAndSaveRef(
  job: MirrorJob,
  token: string,
  tasklistId: string,
  fields: TaskWriteFields,
): Promise<void> {
  const created = await insertTask(token, tasklistId, fields)
  try {
    await saveRef(job.connection_id, job.task_id, tasklistId, created.id)
  } catch (err) {
    // 補償: ref を保存できないと、この job の done で対応が失われ次の更新が二重作成になる。
    // 作ったばかりの Google タスクを消して整合を戻し、temporary_fail として rethrow（再試行）。
    // 補償 delete 自体の失敗は残余リスクとしてログのみ（次サイクルで ref なし→再 insert のリスクは残る）。
    try {
      await deleteTask(token, tasklistId, created.id)
    } catch (delErr) {
      console.error('[task-mirror] saveRef 失敗後の補償 delete も失敗（孤児の可能性）:', delErr)
    }
    throw err
  }
}

async function processJob(job: MirrorJob, token: string, tasklistId: string): Promise<void> {
  const p = job.payload

  if (job.op === 'upsert') {
    const fields: TaskWriteFields = {
      title: typeof p.title === 'string' ? p.title : '(無題)',
      notes: typeof p.notes === 'string' ? p.notes : undefined,
      // due は string|null をそのまま渡す（undefined にしない）。TaskApp 側で due_date を消したとき、
      // null を PATCH で送って Google 側の期日も消す（undefined だと省略され旧期日が残る）。
      due: dateToGoogleDue(typeof p.due_date === 'string' ? p.due_date : null),
      status: 'needsAction' as const,
    }
    const ref = await getRef(job.connection_id, job.task_id)
    if (ref) {
      try {
        await patchTask(token, ref.google_tasklist_id || tasklistId, ref.google_task_id, fields)
      } catch (err) {
        // Google 側で手動削除された等で 404 → stale ref を掃除して作り直す（毒化して dead にしない）。
        if (isNotFound(err)) {
          await deleteRef(job.connection_id, job.task_id)
          await insertAndSaveRef(job, token, tasklistId, fields)
          return
        }
        throw err
      }
    } else {
      await insertAndSaveRef(job, token, tasklistId, fields)
    }
    return
  }

  // complete / delete は refs を第一の正とし、payload の ID はフォールバック（未 insert 段階の
  // fold で payload に ID が無い場合でも、処理時点で saveRef 済みなら refs から引ける）。
  const ref = await getRef(job.connection_id, job.task_id)
  const gid =
    ref?.google_task_id ?? (typeof p.google_task_id === 'string' ? p.google_task_id : null)
  const glist =
    ref?.google_tasklist_id ?? (typeof p.google_tasklist_id === 'string' ? p.google_tasklist_id : tasklistId)

  if (job.op === 'complete') {
    if (gid) {
      try {
        await patchTask(token, glist, gid, { status: 'completed' })
      } catch (err) {
        // 完了させたい相手が既に消えている(404)なら「完了」と同義。ただし stale ref を残すと、
        // 後でタスク再開時の upster が消えた task を patch→404→dead 化するので ref を掃除する。
        if (isNotFound(err)) {
          await deleteRef(job.connection_id, job.task_id)
          return
        }
        throw err
      }
    }
    return
  }

  // delete
  if (gid) await deleteTask(token, glist, gid) // deleteTask は 404 冪等
  await deleteRef(job.connection_id, job.task_id)
}

/** 1接続分のジョブをまとめて処理する(トークン・tasklist を1回だけ解決して使い回す)。 */
async function processConnectionJobs(
  connectionId: string,
  jobs: MirrorJob[],
  summary: MirrorSummary,
): Promise<void> {
  const tok = await getValidTokenDetailed(connectionId, refreshAccessToken)
  if (tok.status !== 'ok') {
    // 失効(auth_failed)は token-manager が connection を expired 化済み。一時失敗で寝かせ、
    // 再接続後に再試行させる(毒にはしない)。
    for (const j of jobs) await completeJob(j, 'temporary_fail', `token_${tok.status}`)
    summary.tempFailed += jobs.length
    return
  }

  let tasklistId: string
  try {
    tasklistId = await resolveTasklistId(connectionId, tok.token)
  } catch (err) {
    const outcome = classifyError(err)
    for (const j of jobs) await completeJob(j, outcome, errMessage(err))
    if (outcome === 'permanent_fail') summary.dead += jobs.length
    else summary.tempFailed += jobs.length
    return
  }

  for (const j of jobs) {
    // 処理直前の lease チェック: 長時間バッチで lease(10分)が切れていたら、この行は既に別 worker が
    // 再取得しうる。complete を呼ばずスキップし、二重確定の窓を局所化する（次サイクルで拾い直す）。
    if (j.leased_until && new Date(j.leased_until).getTime() <= Date.now()) {
      continue
    }
    try {
      await processJob(j, tok.token, tasklistId)
      await completeJob(j, 'done')
      summary.done++
    } catch (err) {
      const outcome = classifyError(err)
      await completeJob(j, outcome, errMessage(err))
      if (outcome === 'permanent_fail') summary.dead++
      else summary.tempFailed++
    }
  }
}

/** ミラー配達ジョブを1バッチ処理する。pg_cron(5分間隔)が /api/cron/task-mirror-dispatch 経由で叩く。 */
export async function dispatchTaskMirrorBatch(limit = 100): Promise<MirrorSummary> {
  const summary: MirrorSummary = { claimed: 0, done: 0, tempFailed: 0, dead: 0 }

  const { data: jobs, error } = await admin().rpc('rpc_claim_task_mirror_jobs', { p_total_limit: limit })
  if (error) {
    console.error('[task-mirror] claim failed:', error)
    return summary
  }
  const list = (jobs as MirrorJob[] | null) ?? []
  summary.claimed = list.length
  if (list.length === 0) return summary

  const byConn = new Map<string, MirrorJob[]>()
  for (const j of list) {
    const arr = byConn.get(j.connection_id) ?? []
    arr.push(j)
    byConn.set(j.connection_id, arr)
  }

  for (const [connId, connJobs] of byConn) {
    await processConnectionJobs(connId, connJobs, summary)
  }
  return summary
}
