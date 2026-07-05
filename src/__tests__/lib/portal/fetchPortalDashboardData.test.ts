import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchPortalDashboardData } from '@/lib/portal/fetchPortalDashboardData'

/**
 * `/portal`（クライアント本人）と `/portal/preview/[spaceId]`（内部ユーザー向け
 * プレビュー）が同一の集計結果を返すことを保証するための単体テスト。
 *
 * この関数は `space_id` を渡された後に固定順で以下のクエリを実行する:
 *   1. tasks (considering, ball=client)
 *   2. tasks (other active, ball=client)
 *   3. tasks count (ball=internal, open/in_progress)
 *   4. tasks count (status=done)
 *   5. tasks count (total)
 *   6. milestones
 *   7. notifications
 *   8. tasks (recently completed)
 *   9. review_approvals
 *   10-11. (次のマイルストーンがある場合のみ) フェーズ内 done/total カウント
 *   12. (通知が task_id を持つ場合のみ) 可視タスクID確認
 *
 * 個々のクエリチェーン形状(eq/neq/order/in/limit)はテーブルに依らないため、
 * モックは呼び出し順に応じたレスポンスを返すだけの汎用ビルダーにしている。
 */

interface QueueResponse {
  data?: unknown
  count?: number | null
  error?: unknown
}

function buildSupabaseMock(responses: QueueResponse[]) {
  let cursor = 0
  const makeBuilder = (): Record<string, unknown> => {
    const builder: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'neq', 'order', 'in', 'limit']) {
      builder[method] = vi.fn(() => builder)
    }
    builder.then = (resolve: (v: QueueResponse) => unknown, reject?: (e: unknown) => unknown) => {
      const response = responses[cursor] ?? { data: null, error: null }
      cursor += 1
      return Promise.resolve(response).then(resolve, reject)
    }
    return builder
  }

  const from = vi.fn(() => makeBuilder())
  return { from } as unknown as SupabaseClient
}

describe('fetchPortalDashboardData', () => {
  it('aggregates tasks/milestones/notifications/approvals into the dashboard shape', async () => {
    const supabase = buildSupabaseMock([
      // 1. considering tasks
      {
        data: [
          {
            id: 'task-1',
            title: '見積もりのご確認',
            description: '',
            status: 'considering',
            due_date: '2026-07-01',
            type: 'task',
            created_at: '2026-06-20T00:00:00+09:00',
            estimated_cost: null,
            estimate_status: 'none',
          },
        ],
        error: null,
      },
      // 2. other active client-ball tasks
      { data: [], error: null },
      // 3. internal count
      { count: 2, error: null },
      // 4. completed count
      { count: 5, error: null },
      // 5. total count
      { count: 8, error: null },
      // 6. milestones (one upcoming, not yet due -> phase queries run)
      {
        data: [
          { id: 'milestone-1', name: '第1フェーズ', completed_at: null, due_date: '2099-01-01' },
        ],
        error: null,
      },
      // 7. notifications (carries a task_id -> visibleTasks query runs)
      {
        data: [
          {
            id: 'notif-1',
            type: 'task_completed',
            payload: { message: 'タスクが完了しました', task_id: 'task-2' },
            created_at: '2026-06-25T00:00:00+09:00',
          },
        ],
        error: null,
      },
      // 8. recently completed tasks
      {
        data: [
          { id: 'task-2', title: '議事録の作成', completed_at: '2026-06-24T00:00:00+09:00', updated_at: '2026-06-24T00:00:00+09:00' },
        ],
        error: null,
      },
      // 9. review approvals
      { data: [], error: null },
      // 10. phase completed count
      { count: 1, error: null },
      // 11. phase total count
      { count: 4, error: null },
      // 12. visible task ids
      { data: [{ id: 'task-2' }], error: null },
    ])

    const result = await fetchPortalDashboardData(supabase, 'space-1')

    expect(result.progress).toEqual({ completedCount: 5, totalCount: 8, deadline: '2099-01-01' })
    expect(result.ballOwnership).toEqual({ clientCount: 1, teamCount: 2 })
    expect(result.currentPhaseProgress).toEqual({ completedCount: 1, totalCount: 4, phaseName: '第1フェーズ' })
    expect(result.totalActionCount).toBe(1)
    expect(result.actionTasks).toHaveLength(1)
    expect(result.actionTasks[0]).toMatchObject({ id: 'task-1', title: '見積もりのご確認' })
    expect(result.milestones).toEqual([
      { id: 'milestone-1', name: '第1フェーズ', status: 'current', dueDate: '2099-01-01' },
    ])
    // notification points at a visible task -> activity should carry taskId through
    expect(result.activities.some((a) => a.taskId === 'task-2')).toBe(true)
    expect(result.approvals).toEqual([])
  })

  it('degrades gracefully (empty arrays, logged error) when a query fails', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const supabase = buildSupabaseMock([
      { data: null, error: { message: 'boom' } }, // 1. considering — fails
      { data: [], error: null }, // 2. other client tasks
      { count: 0, error: null }, // 3. internal count
      { count: 0, error: null }, // 4. completed count
      { count: 0, error: null }, // 5. total count
      { data: [], error: null }, // 6. milestones (none -> no phase queries)
      { data: [], error: null }, // 7. notifications (none -> no visibleTasks query)
      { data: [], error: null }, // 8. recently completed
      { data: [], error: null }, // 9. approvals
    ])

    const result = await fetchPortalDashboardData(supabase, 'space-1')

    expect(result.actionTasks).toEqual([])
    expect(result.totalActionCount).toBe(0)
    expect(result.waitingMessage).toBe('すべてのタスクが確認済みです')
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[Portal Dashboard] considering query error:',
      { message: 'boom' }
    )

    consoleErrorSpy.mockRestore()
  })
})
