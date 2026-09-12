import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useMilestones } from '@/lib/hooks/useMilestones'
import type { TasksQueryData } from '@/lib/supabase/queries'
import type { Task } from '@/types/database'

/**
 * 回帰: マイルストーンを削除すると共有キャッシュ（['milestones', spaceId]）からはすぐ消えるが、
 * タスク側のキャッシュ（['tasks', orgId, spaceId]）は DB の ON DELETE SET NULL を反映せず
 * 古い milestone_id を持ったまま残る。タスク一覧・ガントは「一覧にあるマイルストーンか null」
 * のタスクしかグループにしないため、取り直しが終わるまでタスクが消えて見えていた。
 *
 * また、追加・削除のたびに ['spaceContentCounts', spaceId]（設定タブの件数表示）も
 * 古いままにならないよう、取り直しを促す。
 */

const mockMilestonesRow = {
  id: 'm1',
  org_id: 'org-1',
  space_id: 'space-1',
  name: '既存マイルストーン',
  start_date: null,
  due_date: null,
  order_key: 0,
  completed_at: null,
  created_at: '2026-01-01T00:00:00',
  updated_at: '2026-01-01T00:00:00',
}

let deleteEqMock = vi.fn().mockResolvedValue({ error: null })
let insertSingleMock = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => Promise.resolve({ data: [mockMilestonesRow], error: null }),
        }),
      }),
      insert: () => ({
        select: () => ({
          single: () => insertSingleMock(),
        }),
      }),
      delete: () => ({
        eq: (..._args: unknown[]) => deleteEqMock(..._args),
      }),
    }),
  }),
}))

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

const tasksQueryKey = ['tasks', 'org-1', 'space-1'] as const
const otherSpaceTasksQueryKey = ['tasks', 'org-1', 'space-2'] as const
const countsQueryKey = ['spaceContentCounts', 'space-1'] as const

beforeEach(() => {
  deleteEqMock = vi.fn().mockResolvedValue({ error: null })
  insertSingleMock = vi.fn()
})

describe('useMilestones — deleteMilestone の波及', () => {
  it('削除したマイルストーンを指していたタスクの milestone_id を、その space の tasks キャッシュ上で null にする', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const tasksData: TasksQueryData = {
      tasks: [
        { id: 't1', milestone_id: 'm1' } as unknown as Task,
        // 別のマイルストーンを指す無関係のタスク（'m1' の削除で巻き込まれてはいけない）
        { id: 't2', milestone_id: 'm-other' } as unknown as Task,
      ],
      owners: {},
      reviewStatuses: {},
    }
    queryClient.setQueryData(tasksQueryKey, tasksData)

    // 別 space の tasks キャッシュ。同じ 'm1' を指していても、この space のキャッシュは
    // 書き換わってはいけない（predicate は queryKey[2] === spaceId で絞る想定）
    const otherSpaceTasksData: TasksQueryData = {
      tasks: [{ id: 't3', milestone_id: 'm1' } as unknown as Task],
      owners: {},
      reviewStatuses: {},
    }
    queryClient.setQueryData(otherSpaceTasksQueryKey, otherSpaceTasksData)

    const { result } = renderHook(() => useMilestones({ spaceId: 'space-1' }), {
      wrapper: makeWrapper(queryClient),
    })

    await waitFor(() => expect(result.current.milestones).toHaveLength(1))

    await result.current.deleteMilestone('m1')

    const updated = queryClient.getQueryData<TasksQueryData>(tasksQueryKey)
    expect(updated?.tasks.find((t) => t.id === 't1')?.milestone_id).toBeNull()
    // 無関係のタスク（別のマイルストーンを指す）はそのまま
    expect(updated?.tasks.find((t) => t.id === 't2')?.milestone_id).toBe('m-other')

    // 別 space のタスクキャッシュは書き換わらない
    const otherUpdated = queryClient.getQueryData<TasksQueryData>(otherSpaceTasksQueryKey)
    expect(otherUpdated?.tasks.find((t) => t.id === 't3')?.milestone_id).toBe('m1')
  })

  it('削除後、その space の spaceContentCounts を古いままにしない（取り直しを促す）', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(countsQueryKey, { members: 1, wikiPages: 0, milestones: 1 })

    const { result } = renderHook(() => useMilestones({ spaceId: 'space-1' }), {
      wrapper: makeWrapper(queryClient),
    })
    await waitFor(() => expect(result.current.milestones).toHaveLength(1))

    await result.current.deleteMilestone('m1')

    expect(queryClient.getQueryState(countsQueryKey)?.isInvalidated).toBe(true)
  })

  it('作成後も、その space の spaceContentCounts を古いままにしない', async () => {
    insertSingleMock.mockResolvedValue({
      data: { ...mockMilestonesRow, id: 'm2', name: '新規MS' },
      error: null,
    })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(countsQueryKey, { members: 1, wikiPages: 0, milestones: 1 })

    const { result } = renderHook(() => useMilestones({ spaceId: 'space-1' }), {
      wrapper: makeWrapper(queryClient),
    })
    await waitFor(() => expect(result.current.milestones).toHaveLength(1))

    await result.current.createMilestone({ name: '新規MS' })

    expect(queryClient.getQueryState(countsQueryKey)?.isInvalidated).toBe(true)
  })
})
