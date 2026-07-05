import { describe, it, expect } from 'vitest'
import { buildPortalActivities } from '@/lib/portal/buildPortalActivities'

/**
 * Regression tests for B-3: the portal activity feed dropped task_id when
 * mapping notification rows / completed tasks into feed items, so
 * `ball_passed` activities had nowhere to link even though the underlying
 * task is known.
 */
describe('buildPortalActivities', () => {
  it('carries task_id from a notification payload into taskId on the activity item', () => {
    const activities = buildPortalActivities({
      notifications: [
        {
          id: 'notif-1',
          type: 'ball_passed',
          payload: { message: 'ボールが移動しました', task_id: 'task-1' },
          created_at: '2026-07-01T10:00:00+09:00',
        },
      ],
      completedTasks: [],
    })

    expect(activities).toHaveLength(1)
    expect(activities[0]).toMatchObject({
      id: 'notif-1',
      type: 'notification',
      taskId: 'task-1',
    })
  })

  it('leaves taskId undefined when the notification payload has no task_id', () => {
    const activities = buildPortalActivities({
      notifications: [
        {
          id: 'notif-2',
          type: 'meeting_ended',
          payload: { message: '会議が終了しました' },
          created_at: '2026-07-01T10:00:00+09:00',
        },
      ],
      completedTasks: [],
    })

    expect(activities[0].taskId).toBeUndefined()
  })

  it('sets taskId to the task\'s own id for completed-task activities', () => {
    const activities = buildPortalActivities({
      notifications: [],
      completedTasks: [
        { id: 'task-2', title: '要件定義書', completed_at: '2026-07-02T09:00:00+09:00', updated_at: '2026-07-02T09:00:00+09:00' },
      ],
    })

    expect(activities).toHaveLength(1)
    expect(activities[0]).toMatchObject({
      id: 'completed-task-2',
      type: 'task_completed',
      taskId: 'task-2',
    })
  })

  it('sorts combined activities by timestamp descending and caps at the given limit', () => {
    const activities = buildPortalActivities(
      {
        notifications: [
          { id: 'n1', type: 'ball_passed', payload: { message: 'old', task_id: 't1' }, created_at: '2026-07-01T00:00:00+09:00' },
          { id: 'n2', type: 'ball_passed', payload: { message: 'newest', task_id: 't2' }, created_at: '2026-07-03T00:00:00+09:00' },
        ],
        completedTasks: [
          { id: 't3', title: 'mid', completed_at: '2026-07-02T00:00:00+09:00', updated_at: '2026-07-02T00:00:00+09:00' },
        ],
      },
      2
    )

    expect(activities).toHaveLength(2)
    expect(activities[0].id).toBe('n2')
    expect(activities[1].id).toBe('completed-t3')
  })
})
