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

async function completeJob(jobId: string, outcome: string, error?: string): Promise<void> {
  await admin().rpc('rpc_complete_task_mirror_job', { p_job_id: jobId, p_outcome: outcome, p_error: error ?? null })
}

/** 接続の metadata から tasklist_id を得る。無ければ ensureTaskList で確保し metadata に保存する。 */
async function resolveTasklistId(connectionId: string, token: string): Promise<string> {
  const { data: conn } = await admin()
    .from('integration_connections')
    .select('metadata')
    .eq('id', connectionId)
    .single()
  const metadata = (conn?.metadata as Record<string, unknown> | null) ?? {}
  const existing = metadata.tasklist_id
  if (typeof existing === 'string' && existing) return existing

  const tasklistId = await ensureTaskList(token, GOOGLE_TASKS_LIST_TITLE)
  await admin()
    .from('integration_connections')
    .update({ metadata: { ...metadata, tasklist_id: tasklistId } })
    .eq('id', connectionId)
  return tasklistId
}

async function getRef(
  connectionId: string,
  taskId: string,
): Promise<{ google_task_id: string; google_tasklist_id: string } | null> {
  const { data } = await admin()
    .from('user_task_mirror_refs')
    .select('google_task_id, google_tasklist_id')
    .eq('connection_id', connectionId)
    .eq('task_id', taskId)
    .maybeSingle()
  return (data as { google_task_id: string; google_tasklist_id: string } | null) ?? null
}

async function saveRef(
  connectionId: string,
  taskId: string,
  tasklistId: string,
  googleTaskId: string,
): Promise<void> {
  await admin()
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
}

async function deleteRef(connectionId: string, taskId: string): Promise<void> {
  await admin()
    .from('user_task_mirror_refs')
    .delete()
    .eq('connection_id', connectionId)
    .eq('task_id', taskId)
}

async function processJob(job: MirrorJob, token: string, tasklistId: string): Promise<void> {
  const p = job.payload

  if (job.op === 'upsert') {
    const fields = {
      title: typeof p.title === 'string' ? p.title : '(無題)',
      notes: typeof p.notes === 'string' ? p.notes : undefined,
      due: dateToGoogleDue(typeof p.due_date === 'string' ? p.due_date : null) ?? undefined,
      status: 'needsAction' as const,
    }
    const ref = await getRef(job.connection_id, job.task_id)
    if (ref) {
      await patchTask(token, ref.google_tasklist_id || tasklistId, ref.google_task_id, fields)
    } else {
      const created = await insertTask(token, tasklistId, fields)
      await saveRef(job.connection_id, job.task_id, tasklistId, created.id)
    }
    return
  }

  if (job.op === 'complete') {
    const gid = typeof p.google_task_id === 'string' ? p.google_task_id : null
    const glist = typeof p.google_tasklist_id === 'string' ? p.google_tasklist_id : tasklistId
    if (gid) await patchTask(token, glist, gid, { status: 'completed' })
    return
  }

  // delete
  const gid = typeof p.google_task_id === 'string' ? p.google_task_id : null
  const glist = typeof p.google_tasklist_id === 'string' ? p.google_tasklist_id : tasklistId
  if (gid) await deleteTask(token, glist, gid)
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
    for (const j of jobs) await completeJob(j.id, 'temporary_fail', `token_${tok.status}`)
    summary.tempFailed += jobs.length
    return
  }

  let tasklistId: string
  try {
    tasklistId = await resolveTasklistId(connectionId, tok.token)
  } catch (err) {
    const outcome = classifyError(err)
    for (const j of jobs) await completeJob(j.id, outcome, errMessage(err))
    if (outcome === 'permanent_fail') summary.dead += jobs.length
    else summary.tempFailed += jobs.length
    return
  }

  for (const j of jobs) {
    try {
      await processJob(j, tok.token, tasklistId)
      await completeJob(j.id, 'done')
      summary.done++
    } catch (err) {
      const outcome = classifyError(err)
      await completeJob(j.id, outcome, errMessage(err))
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
