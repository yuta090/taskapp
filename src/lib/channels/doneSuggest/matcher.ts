import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * 完了サジェスト照合（Tier1・決定的・Fable裁定「完了サジェスト」v1）。
 *
 * 発生元グループ(channel_groups.id)に紐づく未完了タスクを、
 * channel_digest_tasks.promoted_task_id（rpc_promote_digest_task / 20260715074403）経由で
 * 本体 tasks へ逆引きし、status<>'done' のものだけを候補にする。
 *
 * 「ちょうど1件」のときだけ発火し、0件（該当タスク無し）/2件以上（曖昧）は
 * 沈黙（null）にする — precision優先（詳細は detector.ts コメント参照）。
 */

function admin(): SupabaseClient {
  return createAdminClient() as SupabaseClient
}

export interface OpenTaskCandidate {
  id: string
  title: string
}

/** 純関数: 候補配列から「ちょうど1件」のときだけ返す。0件/2件以上はnull(=沈黙)。 */
export function pickSingleOpenTask(
  candidates: OpenTaskCandidate[],
): { taskId: string; title: string } | null {
  if (candidates.length !== 1) return null
  const [only] = candidates
  return { taskId: only.id, title: only.title }
}

/**
 * 発生元グループに紐づく未完了のpromotedタスクを解決する（store層・admin client）。
 * promoted_task_idの重複（同一タスクへ複数digest行が指す万一のケース）はSetで畳んでから
 * 件数判定するため、候補の水増しにはならない。
 */
export async function findOpenPromotedTaskForGroup(
  groupId: string,
): Promise<{ taskId: string; title: string } | null> {
  const { data: digestRows, error: digestError } = await admin()
    .from('channel_digest_tasks')
    .select('promoted_task_id')
    .eq('group_id', groupId)
    .eq('promotion_state', 'promoted')
    .not('promoted_task_id', 'is', null)

  if (digestError) {
    throw new Error(`channel_digest_tasks: open task lookup failed: ${digestError.message}`)
  }

  const taskIds = [
    ...new Set(
      (digestRows ?? [])
        .map((row) => (row as { promoted_task_id: string | null }).promoted_task_id)
        .filter((id): id is string => !!id),
    ),
  ]
  if (taskIds.length === 0) return null

  const { data: taskRows, error: taskError } = await admin()
    .from('tasks')
    .select('id, title')
    .in('id', taskIds)
    .neq('status', 'done')

  if (taskError) {
    throw new Error(`tasks: open task lookup failed: ${taskError.message}`)
  }

  const candidates: OpenTaskCandidate[] = (taskRows ?? []).map((row) => {
    const r = row as { id: string; title: string }
    return { id: r.id, title: r.title }
  })

  return pickSingleOpenTask(candidates)
}
