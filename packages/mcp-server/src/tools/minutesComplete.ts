import { z } from 'zod'
import { getSupabaseClient } from '../supabase/client.js'
import { checkAuth } from '../auth/helpers.js'
import { collectCheckedTaskIds } from '../lib/checkboxCompletion.js'
import { buildTaskLink } from '../lib/appLinks.js'

/**
 * 議事録でチェックが付いている行のタスクを、まとめて完了にする道具。
 *
 * 画面では行にチェックを入れた瞬間にタスクが完了になるが、それはブラウザの中の処理で、
 * CLI から本文を `- [x]` に書き換えても何も起きない（見た目が変わるだけ）。会議のあとに
 * CLI で議事録を整える使い方では、完了にし忘れたタスクが残ってしまう。
 *
 * 画面との違い:
 *   - 画面は「チェックが入った瞬間」を前後の本文の差分で拾う。CLI には前の本文が無いので、
 *     **いま付いているチェックをまとめて見る**。すでに完了のものは飛ばすので、何度実行しても
 *     結果は同じ。
 *   - 外したチェックは見ない（完了の取り消しはしない）。画面と同じ。
 *   - 決まっていない決定事項のタスクは完了にできない。**勝手に決定にはしない**（決めるのは人）。
 *     理由を添えて「できなかった」として返す。
 */

const baseSchema = {
  spaceId: z.string().uuid().describe('スペースUUID（必須）'),
  meetingId: z.string().uuid().describe('会議UUID'),
}

export const minutesCompleteCheckedSchema = z.object({
  ...baseSchema,
  dryRun: z
    .boolean()
    .optional()
    .describe('true なら完了にせず、対象を数えるだけ（既定 false）'),
})

export interface MinutesCompleteItem {
  taskId: string
  title: string
  /** 'completed' = 完了にした / 'already_done' = すでに完了 / 'blocked' = できなかった */
  result: 'completed' | 'already_done' | 'blocked'
  /** できなかった理由（blocked のときだけ） */
  reason?: string
  link: string
}

export interface MinutesCompleteResult {
  ok: boolean
  /** チェックが付いていて、タスクのある行の数 */
  checkedCount: number
  completedCount: number
  items: MinutesCompleteItem[]
  /** dryRun のときだけ true */
  dryRun?: boolean
}

interface TaskRow {
  id: string
  title: string
  status: string
  type: string
  decision_state: string | null
}

/**
 * 完了の関所（DB の enforce_review_gate・check_violation）に止められたときの理由。
 * 止めた理由は決まった文言で秘密を含まない。該当しなければ null。
 * `packages/mcp-server/src/tools/tasks.ts` の同名の処理と同じ文言にそろえている。
 */
function completionGateReason(error: { code?: string; message?: string }): string | null {
  if (error.code !== '23514') return null
  if (error.message?.includes('review is not approved')) {
    return 'レビューの承認が済んでいないため、完了にできません。承認されてから完了にしてください'
  }
  if (error.message?.includes('spec decision is not made')) {
    return '決定事項がまだ決まっていないため、完了にできません。先に spec decide で確定してください'
  }
  return null
}

export async function minutesCompleteChecked(
  params: z.infer<typeof minutesCompleteCheckedSchema>
): Promise<MinutesCompleteResult> {
  await checkAuth(params.spaceId, 'write', 'minutes_complete_checked', 'meeting', params.meetingId)
  const supabase = getSupabaseClient()

  const { data: space, error: spaceError } = await supabase
    .from('spaces')
    .select('org_id')
    .eq('id', params.spaceId)
    .single()
  if (spaceError || !space) throw new Error('スペースが見つかりません')
  const orgId = (space as { org_id: string }).org_id

  const { data: meeting, error: meetingError } = await supabase
    .from('meetings')
    .select('id, minutes_md')
    .eq('id', params.meetingId)
    .eq('org_id', orgId)
    .eq('space_id', params.spaceId)
    .single()
  if (meetingError || !meeting) throw new Error('会議が見つかりません')

  const minutesMd = (meeting as { minutes_md: string | null }).minutes_md ?? ''
  const taskIds = collectCheckedTaskIds(minutesMd)
  if (taskIds.length === 0) {
    return { ok: true, checkedCount: 0, completedCount: 0, items: [], ...(params.dryRun ? { dryRun: true } : {}) }
  }

  // 目印の UUID は本文から来る。**この space のタスクに限って**引き、よそのタスクを
  // 動かせないようにする（この道具は service role で動き、RLS を通らないため）
  const { data: rows, error: tasksError } = await supabase
    .from('tasks')
    .select('id, title, status, type, decision_state')
    .in('id', taskIds)
    .eq('org_id', orgId)
    .eq('space_id', params.spaceId)
  if (tasksError) throw new Error('タスクを読めませんでした')

  const tasks = (rows ?? []) as TaskRow[]
  const items: MinutesCompleteItem[] = []

  for (const task of tasks) {
    const link = buildTaskLink(orgId, params.spaceId, task.id)
    if (task.status === 'done') {
      items.push({ taskId: task.id, title: task.title, result: 'already_done', link })
      continue
    }

    // 下見では書き込まない。DB の関所と同じ判定を先に行い、結果の見込みを返す
    if (params.dryRun) {
      const undecided = task.type === 'spec' && task.decision_state === 'considering'
      items.push(
        undecided
          ? {
              taskId: task.id,
              title: task.title,
              result: 'blocked',
              reason: '決定事項がまだ決まっていないため、完了にできません。先に spec decide で確定してください',
              link,
            }
          : { taskId: task.id, title: task.title, result: 'completed', link }
      )
      continue
    }

    const { error } = await supabase
      .from('tasks')
      .update({ status: 'done', updated_at: new Date().toISOString() })
      .eq('id', task.id)
      .eq('org_id', orgId)
      .eq('space_id', params.spaceId)

    if (error) {
      const reason = completionGateReason(error)
      if (reason) {
        items.push({ taskId: task.id, title: task.title, result: 'blocked', reason, link })
        continue
      }
      // それ以外の DB の理由は中身を含むので呼んだ人には返さず、サーバーのログにだけ残す
      console.error('minutes_complete_checked failed:', error.code, error.message)
      items.push({
        taskId: task.id,
        title: task.title,
        result: 'blocked',
        reason: '完了にできませんでした',
        link,
      })
      continue
    }
    items.push({ taskId: task.id, title: task.title, result: 'completed', link })
  }

  return {
    ok: true,
    checkedCount: taskIds.length,
    completedCount: items.filter((i) => i.result === 'completed').length,
    items,
    ...(params.dryRun ? { dryRun: true } : {}),
  }
}

export const minutesCompleteTools = [
  {
    name: 'minutes_complete_checked',
    description:
      '議事録でチェックが付いている行（`- [x] … <!--task:uuid-->`）のタスクを完了にする。画面でチェックを入れたときと同じ。すでに完了のものは飛ばすので何度実行してもよい。決まっていない決定事項のタスクは、理由を添えて断る（勝手に決定にはしない）',
    inputSchema: minutesCompleteCheckedSchema,
    handler: minutesCompleteChecked,
  },
]
