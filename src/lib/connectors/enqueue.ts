import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * connector_jobs(TaskApp→外部のアウトボックス)への enqueue 共通実装(fold付き)。
 *
 * 元は src/lib/google-tasks/import.ts に private 定義されていたが、multica webhook 受信側の
 * 完了伝播(src/lib/connectors/inbound.ts: gtasks 書き戻しの enqueue)からも使うため
 * 共有モジュールへ切り出した(双方向同期コネクタ層のアウトボックスは provider を問わず同じ
 * table/fold 規約を使うため。import.ts 側はこの関数を re-export するだけにしてある)。
 *
 * 同一(connection_id,task_id)の pending ジョブが既にあれば最新の op/payload で上書きし
 * version を進める。connector_jobs_pending_unique(migration の partial unique index)による
 * insert 競合(23505)を検知して fold 更新に倒す(google-tasks/import.ts の
 * createExternalTask のリンク競合対応と同じ流儀)。
 * 呼び出し側は best-effort とし、失敗しても呼び出し元の処理自体は継続する(呼び出し元でcatchする)。
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

export async function enqueueConnectorJob(
  connectionId: string,
  taskId: string,
  op: 'upsert' | 'cancel' | 'complete',
  payload: Record<string, unknown>,
): Promise<void> {
  const { error: insErr } = await admin().from('connector_jobs').insert({
    connection_id: connectionId,
    task_id: taskId,
    op,
    payload,
  })
  if (!insErr) return
  if ((insErr as { code?: string }).code !== '23505') {
    throw new Error(`connector_jobs enqueue failed: ${insErr.message}`)
  }

  // 既存 pending job に fold: 最新の op/payload で上書きし version を進める
  // (rpc_complete_connector_job が処理中の fold をversion不一致で検知し、最新opをpendingのまま残す)。
  const { data: existing, error: selErr } = await admin()
    .from('connector_jobs')
    .select('id, version')
    .eq('connection_id', connectionId)
    .eq('task_id', taskId)
    .eq('status', 'pending')
    .maybeSingle()
  if (selErr) throw new Error(`connector_jobs fold lookup failed: ${selErr.message}`)
  if (!existing) {
    // 別workerがちょうど処理を終え pending が消えた直後の稀な競合窓。素直に再insertする。
    const { error: retryErr } = await admin().from('connector_jobs').insert({
      connection_id: connectionId,
      task_id: taskId,
      op,
      payload,
    })
    if (retryErr) throw new Error(`connector_jobs enqueue retry failed: ${retryErr.message}`)
    return
  }
  const row = existing as { id: string; version: number }
  // next_attempt_at/updated_at はDBのtimestamptz列(表示用ローカル日付ではない)。mirror.ts の
  // saveRef と同じ既存の例外運用として toISOString を使う(protocol/DBタイムスタンプはUTCで正しい)。
  const { error: updErr } = await admin()
    .from('connector_jobs')
    .update({
      op,
      payload,
      version: row.version + 1,
      next_attempt_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', row.id)
  if (updErr) throw new Error(`connector_jobs fold update failed: ${updErr.message}`)
}
