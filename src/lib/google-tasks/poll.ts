import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'
import { getValidTokenDetailed } from '@/lib/integrations/token-manager'
import { refreshAccessToken } from '@/lib/google-calendar/client'
import { listTasks } from './client'

/**
 * 逆流ポーリング: 各 active な google_tasks 接続について Google Tasks を updatedMin で差分取得し、
 * completed になったタスクを refs 経由で TaskApp タスクへ対応づけ、status='done' にする(逆流)。
 *
 * Google Tasks には watch/push が無いためポーリング(15分間隔)。ball は触らない。
 * 完了は rpc_mirror_complete_task が「既に done なら no-op」なので冪等・ループしない。
 * カーソル(metadata.poll_cursor)で差分。初回はカーソル無し=全件を一度なめる(個人リストなので有界)。
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

export interface PollSummary {
  connections: number
  completed: number
  skipped: number
}

interface ConnRow {
  id: string
  metadata: Record<string, unknown> | null
}

/** 接続の refs を google_task_id -> task_id の Map に読み込む。 */
async function loadRefMap(connectionId: string): Promise<Map<string, string>> {
  const { data, error } = await admin()
    .from('user_task_mirror_refs')
    .select('task_id, google_task_id')
    .eq('connection_id', connectionId)
  // ref 取得に失敗したのに完了を「対応なし」で握りつぶすと取りこぼす。throw して cursor を進めない。
  if (error) throw new Error(`loadRefMap failed: ${error.message}`)
  const map = new Map<string, string>()
  for (const r of (data as Array<{ task_id: string; google_task_id: string }> | null) ?? []) {
    map.set(r.google_task_id, r.task_id)
  }
  return map
}

async function pollConnection(conn: ConnRow, summary: PollSummary): Promise<void> {
  const metadata = conn.metadata ?? {}
  const tasklistId = metadata.tasklist_id
  if (typeof tasklistId !== 'string' || !tasklistId) {
    // まだ何もミラーしていない(tasklist 未確保)。完了を拾う対象が無いので skip。
    summary.skipped++
    return
  }

  const tok = await getValidTokenDetailed(conn.id, refreshAccessToken)
  if (tok.status !== 'ok') {
    summary.skipped++
    return
  }

  const cursor = typeof metadata.poll_cursor === 'string' ? metadata.poll_cursor : undefined
  // 次回カーソルはポーリング開始時刻の少し手前(境界の取りこぼし防止)。
  const nextCursor = new Date(Date.now() - 60_000).toISOString()

  let refMap: Map<string, string> | null = null
  try {
    let pageToken: string | undefined
    do {
      const { items, nextPageToken } = await listTasks(tok.token, tasklistId, {
        updatedMin: cursor,
        pageToken,
      })
      const completed = items.filter((t) => t.status === 'completed' && !t.deleted)
      if (completed.length > 0) {
        if (!refMap) refMap = await loadRefMap(conn.id)
        for (const gt of completed) {
          const taskId = refMap.get(gt.id)
          if (!taskId) continue
          const { data, error } = await admin().rpc('rpc_mirror_complete_task', {
            p_connection_id: conn.id,
            p_task_id: taskId,
          })
          // 逆流の適用失敗は cursor を進めず次回再試行（try の外で cursor 前進するため throw で止める）。
          if (error) throw new Error(`rpc_mirror_complete_task failed: ${error.message}`)
          if (data === true) summary.completed++
        }
      }
      pageToken = nextPageToken ?? undefined
    } while (pageToken)
  } catch (err) {
    // 一時失敗はカーソルを進めず次回再試行(取りこぼさない)。
    console.error('[task-mirror-poll] list failed, cursor not advanced:', err)
    summary.skipped++
    return
  }

  // 成功時のみカーソル前進。
  await admin()
    .from('integration_connections')
    .update({ metadata: { ...metadata, poll_cursor: nextCursor } })
    .eq('id', conn.id)
}

/** 逆流ポーリングを1バッチ実行する。pg_cron(15分間隔)が /api/cron/task-mirror-poll 経由で叩く。 */
export async function pollTaskMirrorBatch(): Promise<PollSummary> {
  const summary: PollSummary = { connections: 0, completed: 0, skipped: 0 }

  const { data: conns, error } = await admin()
    .from('integration_connections')
    .select('id, metadata')
    .eq('provider', 'google_tasks')
    .eq('status', 'active')
  if (error) {
    console.error('[task-mirror-poll] connection fetch failed:', error)
    return summary
  }
  const list = (conns as ConnRow[] | null) ?? []
  summary.connections = list.length

  for (const conn of list) {
    await pollConnection(conn, summary)
  }
  return summary
}
