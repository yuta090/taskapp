import { describe, it, expect } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { patchTaskRowInProjectCache } from '@/lib/tasks/taskRowCache'
import type { Task } from '@/types/database'

const task = (over: Partial<Task> & { id: string }): Task =>
  ({
    org_id: 'o1',
    space_id: 's1',
    title: 't',
    status: 'in_review',
    ball: 'internal',
    origin: 'internal',
    type: 'task',
    completed_at: null,
    ...over,
  }) as Task

function clientWith(tasks: Task[]) {
  const qc = new QueryClient()
  qc.setQueryData(['tasks', 'o1', 's1'], { tasks, owners: {}, reviewStatuses: {} })
  return qc
}

describe('patchTaskRowInProjectCache', () => {
  it('該当タスクの行だけを書き換える', () => {
    const qc = clientWith([task({ id: 'a' }), task({ id: 'b' })])

    patchTaskRowInProjectCache(qc, { orgId: 'o1', spaceId: 's1', taskId: 'a', patch: { status: 'done' } })

    const data = qc.getQueryData<{ tasks: Task[] }>(['tasks', 'o1', 's1'])
    expect(data?.tasks.find((t) => t.id === 'a')?.status).toBe('done')
    expect(data?.tasks.find((t) => t.id === 'b')?.status).toBe('in_review')
  })

  it('取得時刻は据え置く（1行直しただけで読み直したわけではない）', async () => {
    const qc = clientWith([task({ id: 'a' })])
    const before = qc.getQueryState(['tasks', 'o1', 's1'])?.dataUpdatedAt
    await new Promise((r) => setTimeout(r, 5))

    patchTaskRowInProjectCache(qc, { orgId: 'o1', spaceId: 's1', taskId: 'a', patch: { status: 'done' } })

    expect(qc.getQueryState(['tasks', 'o1', 's1'])?.dataUpdatedAt).toBe(before)
  })

  it('完了にしたら完了日時を入れ、完了から戻したら消す', () => {
    const qc = clientWith([task({ id: 'a' })])

    patchTaskRowInProjectCache(qc, { orgId: 'o1', spaceId: 's1', taskId: 'a', patch: { status: 'done' } })
    const done = qc.getQueryData<{ tasks: Task[] }>(['tasks', 'o1', 's1'])?.tasks[0]
    expect(done?.completed_at).toBeTruthy()

    patchTaskRowInProjectCache(qc, { orgId: 'o1', spaceId: 's1', taskId: 'a', patch: { status: 'todo' } })
    const back = qc.getQueryData<{ tasks: Task[] }>(['tasks', 'o1', 's1'])?.tasks[0]
    expect(back?.completed_at).toBeNull()
  })

  it('そのプロジェクトのキャッシュが無ければ何もしない（ネットワークも出さない）', () => {
    const qc = new QueryClient()

    patchTaskRowInProjectCache(qc, { orgId: 'o1', spaceId: 's1', taskId: 'a', patch: { status: 'done' } })

    expect(qc.getQueryData(['tasks', 'o1', 's1'])).toBeUndefined()
  })
})
