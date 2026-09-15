import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import {
  useSpaceTaskCommentCounts,
  useMyTaskCommentCounts,
  commentCountsFromRows,
} from '@/lib/hooks/useTaskCommentCounts'

/**
 * タスク一覧の吹き出しアイコンに出すコメント数。
 *
 * 一覧本体(fetchTasksQuery/fetchMyTasksData)の Promise.all には入れない — コメント数の
 * 集計は一覧の1ページ目より遅くなりうる(実測: コメント8,000件のspaceで1.2〜2秒)ため、
 * 一覧の表示を待たせず、別の react-query クエリとして遅れて出す。
 */

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return { ...actual, useQuery: vi.fn(actual.useQuery) }
})

const rpcMock = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    rpc: (...args: unknown[]) => rpcMock(...args),
  }),
}))

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children)
  return { Wrapper, queryClient }
}

function latestUseQueryOptions(): Record<string, unknown> {
  const calls = (useQuery as unknown as ReturnType<typeof vi.fn>).mock.calls
  return calls[calls.length - 1][0] as Record<string, unknown>
}

beforeEach(() => {
  vi.clearAllMocks()
  rpcMock.mockResolvedValue({ data: [], error: null })
})

describe('useSpaceTaskCommentCounts — プロジェクトのタスク一覧のコメント数', () => {
  it('rpc_task_comment_counts を p_space_id 付きで呼び、行を { taskId: 件数 } にする', async () => {
    rpcMock.mockResolvedValue({
      data: [
        { task_id: 'a', comment_count: 3 },
        { task_id: 'b', comment_count: 1 },
      ],
      error: null,
    })
    const { Wrapper } = createWrapper()

    const { result } = renderHook(() => useSpaceTaskCommentCounts('space-1'), { wrapper: Wrapper })

    await waitFor(() => expect(result.current).toEqual({ a: 3, b: 1 }))
    expect(rpcMock).toHaveBeenCalledWith('rpc_task_comment_counts', { p_space_id: 'space-1' })
  })

  it('キー・staleTime(アプリ既定2分=useTasksの一覧と同じ)・enabledを一覧と揃える', async () => {
    const { Wrapper } = createWrapper()
    renderHook(() => useSpaceTaskCommentCounts('space-1'), { wrapper: Wrapper })

    await waitFor(() => expect(useQuery).toHaveBeenCalled())
    const options = latestUseQueryOptions()
    expect(options.queryKey).toEqual(['taskCommentCounts', 'space', 'space-1'])
    expect(options.staleTime).toBe(2 * 60_000)
    expect(options.enabled).toBe(true)
  })

  it('spaceIdが無ければ問い合わせない', () => {
    const { Wrapper } = createWrapper()
    renderHook(() => useSpaceTaskCommentCounts(null), { wrapper: Wrapper })

    const options = latestUseQueryOptions()
    expect(options.enabled).toBe(false)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('初めての読み込みで rpc が失敗しても画面を壊さず、空オブジェクトになる', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    rpcMock.mockResolvedValue({ data: null, error: { message: 'rpc boom' } })
    const { Wrapper } = createWrapper()

    const { result } = renderHook(() => useSpaceTaskCommentCounts('space-1'), { wrapper: Wrapper })

    await waitFor(() => expect(rpcMock).toHaveBeenCalled())
    await waitFor(() => expect(warnSpy).toHaveBeenCalled())
    expect(result.current).toEqual({})
    warnSpy.mockRestore()
  })

  // 失敗を空の数の「成功」として保存すると、全行の吹き出しが消えて2分間戻らず、端末の保存にも残る。
  // さらにその状態でコメントを書くと {} に +1 して、6件あるタスクに「1」と出てしまう
  it('取り直しで rpc が失敗したら、前の数を残す（空の数で上書きしない）', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    rpcMock.mockResolvedValue({ data: [{ task_id: 'task-1', comment_count: 6 }], error: null })
    const { Wrapper, queryClient } = createWrapper()

    const { result } = renderHook(() => useSpaceTaskCommentCounts('space-1'), { wrapper: Wrapper })
    await waitFor(() => expect(result.current).toEqual({ 'task-1': 6 }))

    rpcMock.mockResolvedValue({ data: null, error: { message: 'rpc boom' } })
    await queryClient.refetchQueries({ queryKey: ['taskCommentCounts', 'space', 'space-1'] })

    await waitFor(() => expect(warnSpy).toHaveBeenCalled())
    expect(result.current).toEqual({ 'task-1': 6 })
    expect(queryClient.getQueryState(['taskCommentCounts', 'space', 'space-1'])?.status).toBe('error')
    warnSpy.mockRestore()
  })

  it('読み込み中は共有の空オブジェクトを返す（毎レンダー新しい{}を作らない）', () => {
    rpcMock.mockReturnValue(new Promise(() => {})) // 解決させない
    const { Wrapper } = createWrapper()

    const { result, rerender } = renderHook(() => useSpaceTaskCommentCounts('space-1'), {
      wrapper: Wrapper,
    })
    const first = result.current
    rerender()
    const second = result.current

    expect(first).toBe(second)
  })
})

describe('useMyTaskCommentCounts — マイタスクのコメント数', () => {
  it('rpc_task_comment_counts を p_assignee_id・p_org_id 付きで呼ぶ', async () => {
    rpcMock.mockResolvedValue({ data: [{ task_id: 't1', comment_count: 2 }], error: null })
    const { Wrapper } = createWrapper()

    const { result } = renderHook(() => useMyTaskCommentCounts('user-1', 'org-1'), {
      wrapper: Wrapper,
    })

    await waitFor(() => expect(result.current).toEqual({ t1: 2 }))
    expect(rpcMock).toHaveBeenCalledWith('rpc_task_comment_counts', {
      p_assignee_id: 'user-1',
      p_org_id: 'org-1',
    })
  })

  it('orgIdが無ければ null で呼ぶ', async () => {
    const { Wrapper } = createWrapper()
    renderHook(() => useMyTaskCommentCounts('user-1', null), { wrapper: Wrapper })

    await waitFor(() => expect(rpcMock).toHaveBeenCalled())
    expect(rpcMock).toHaveBeenCalledWith('rpc_task_comment_counts', {
      p_assignee_id: 'user-1',
      p_org_id: null,
    })
  })

  it('キー・staleTimeを一覧と揃える', async () => {
    const { Wrapper } = createWrapper()
    renderHook(() => useMyTaskCommentCounts('user-1', 'org-1'), { wrapper: Wrapper })

    await waitFor(() => expect(useQuery).toHaveBeenCalled())
    const options = latestUseQueryOptions()
    expect(options.queryKey).toEqual(['taskCommentCounts', 'assignee', 'user-1', 'org-1'])
    expect(options.staleTime).toBe(2 * 60_000)
  })

  it('userIdが無ければ問い合わせない', () => {
    const { Wrapper } = createWrapper()
    renderHook(() => useMyTaskCommentCounts(null, 'org-1'), { wrapper: Wrapper })

    const options = latestUseQueryOptions()
    expect(options.enabled).toBe(false)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  // マイタスク本体（myTasksQuery）は組織の判定が終わるまで読まない（別の組織のぶんが混ざらないように）。
  // コメント数も同じ条件にしないと、判定前に「全組織ぶん」で1回・判定後にもう1回読みに行く
  it('enabled: false（組織の判定中）の間は問い合わせない', () => {
    const { Wrapper } = createWrapper()
    renderHook(() => useMyTaskCommentCounts('user-1', null, { enabled: false }), { wrapper: Wrapper })

    const options = latestUseQueryOptions()
    expect(options.enabled).toBe(false)
    expect(rpcMock).not.toHaveBeenCalled()
  })
})

describe('commentCountsFromRows', () => {
  it('行配列を { taskId: 件数 } に変換する', () => {
    expect(
      commentCountsFromRows([
        { task_id: 'a', comment_count: 2 },
        { task_id: 'b', comment_count: 0 },
      ])
    ).toEqual({ a: 2, b: 0 })
  })

  it('null/undefined は空オブジェクトにする', () => {
    expect(commentCountsFromRows(null)).toEqual({})
    expect(commentCountsFromRows(undefined)).toEqual({})
  })
})
