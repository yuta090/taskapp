import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useTaskComments } from '@/lib/hooks/useTaskComments'

/**
 * 書き手のプロフィール（display_name）が読めなかったとき（DB 側で他の人のプロフィールを
 * 読める範囲を「一緒に仕事をしている人」に絞る変更の前でも後でも）、生の ID の一部
 * （actor_id.slice(0,8) + '...'）を出すのではなく、分かる一語にする。
 */

const commentRow = {
  id: 'c1',
  org_id: 'org-1',
  space_id: 'space-1',
  task_id: 'task-1',
  actor_id: 'ghost-user-id-0001',
  body: 'こんにちは',
  visibility: 'internal' as const,
  reply_to_id: null,
  created_at: '2026-01-01T00:00:00',
  updated_at: '2026-01-01T00:00:00',
  deleted_at: null,
}

// select().eq().eq().eq().is().order() のどこで await されても同じ結果を返す
// 自己再帰のチェーン可能な thenable。insert()/update() も同じテーブルモックから
// 呼べるよう、コメント数のテストで使う insert/update の結果を差し込めるようにする。
function makeCommentsQueryBuilder(
  result: { data: unknown; error: unknown },
  opts: {
    insertResult?: { data: unknown; error: unknown }
    updateResult?: { error: unknown }
  } = {}
) {
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    is: () => builder,
    order: () => builder,
    then: (resolve: (v: unknown) => void) => resolve(result),
    insert: () => ({
      select: () => ({
        single: () =>
          Promise.resolve(opts.insertResult ?? { data: null, error: new Error('insertResult not configured') }),
      }),
    }),
    update: () => ({
      eq: () =>
        Promise.resolve(opts.updateResult ?? { error: new Error('updateResult not configured') }),
    }),
  }
  return builder
}

let profilesResponse: { data: Array<{ id: string; display_name: string; avatar_url: string | null }> | null; error: unknown }
// createComment/softDeleteComment のテスト用。既定は「未設定」のまま失敗させる
// （個々のテストで明示的に設定する）
let commentsInsertResponse: { data: unknown; error: unknown } | undefined
let commentsUpdateResponse: { error: unknown } | undefined

const mockFrom = vi.fn((table: string) => {
  if (table === 'task_comments') {
    return makeCommentsQueryBuilder(
      { data: [commentRow], error: null },
      { insertResult: commentsInsertResponse, updateResult: commentsUpdateResponse }
    )
  }
  if (table === 'profiles') {
    return {
      select: () => ({
        in: () => Promise.resolve(profilesResponse),
      }),
    }
  }
  throw new Error(`unexpected table: ${table}`)
})

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: mockFrom,
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      getUser: () => Promise.resolve({ data: { user: { id: 'me' } }, error: null }),
    },
  }),
}))

vi.mock('@/lib/slack/notify', () => ({ fireNotification: vi.fn() }))

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

beforeEach(() => {
  profilesResponse = { data: [], error: null }
  commentsInsertResponse = undefined
  commentsUpdateResponse = undefined
})

describe('useTaskComments — 書き手のプロフィールが読めないときの表示', () => {
  it('プロフィールが見つからない書き手は、IDの一部ではなく分かる一語にする', async () => {
    const { result } = renderHook(
      () => useTaskComments({ orgId: 'org-1', spaceId: 'space-1', taskId: 'task-1' }),
      { wrapper: makeWrapper(new QueryClient({ defaultOptions: { queries: { retry: false } } })) }
    )

    await waitFor(() => expect(result.current.comments).toHaveLength(1))

    expect(result.current.comments[0].actor_name).toBe('（メンバー外）')
    expect(result.current.comments[0].actor_name).not.toContain(commentRow.actor_id.slice(0, 8))
  })

  it('プロフィールが見つかれば、これまでどおり表示名を使う', async () => {
    profilesResponse = {
      data: [{ id: commentRow.actor_id, display_name: 'テスト太郎', avatar_url: null }],
      error: null,
    }

    const { result } = renderHook(
      () => useTaskComments({ orgId: 'org-1', spaceId: 'space-1', taskId: 'task-1' }),
      { wrapper: makeWrapper(new QueryClient({ defaultOptions: { queries: { retry: false } } })) }
    )

    await waitFor(() => expect(result.current.comments).toHaveLength(1))

    expect(result.current.comments[0].actor_name).toBe('テスト太郎')
  })
})

/**
 * タスク一覧・マイタスク一覧の吹き出しアイコンに出すコメント数は、一覧本体
 * （['tasks', …] / ['myTasks', …]）とは別読みのキャッシュ（['taskCommentCounts', …]、
 * useTaskCommentCounts 参照）に持つ。コメントの作成・削除の成功後、そのキャッシュだけを
 * ±1 する（一覧全体の取り直しはしない）。保存に失敗したときは数を変えない。
 */
describe('useTaskComments — コメント数キャッシュ(taskCommentCounts)を±1する', () => {
  const spaceCountsKey = ['taskCommentCounts', 'space', 'space-1'] as const
  const myCountsKey = ['taskCommentCounts', 'assignee', 'user-1', 'org-1'] as const

  it('createComment 成功後、space 単位のコメント数キャッシュが +1 される', async () => {
    commentsInsertResponse = { data: { ...commentRow, id: 'new-1' }, error: null }
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(spaceCountsKey, { 'task-1': 2 })

    const { result } = renderHook(
      () => useTaskComments({ orgId: 'org-1', spaceId: 'space-1', taskId: 'task-1' }),
      { wrapper: makeWrapper(queryClient) }
    )
    await waitFor(() => expect(result.current.comments).toHaveLength(1))

    await act(async () => {
      await result.current.createComment({ body: '新しいコメント' })
    })

    expect(queryClient.getQueryData(spaceCountsKey)).toEqual({ 'task-1': 3 })
  })

  it('createComment 成功後、マイタスク側(assignee単位)のコメント数キャッシュも +1 される', async () => {
    commentsInsertResponse = { data: { ...commentRow, id: 'new-1' }, error: null }
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(myCountsKey, { 'task-1': 5 })

    const { result } = renderHook(
      () => useTaskComments({ orgId: 'org-1', spaceId: 'space-1', taskId: 'task-1' }),
      { wrapper: makeWrapper(queryClient) }
    )
    await waitFor(() => expect(result.current.comments).toHaveLength(1))

    await act(async () => {
      await result.current.createComment({ body: '新しいコメント' })
    })

    expect(queryClient.getQueryData(myCountsKey)).toEqual({ 'task-1': 6 })
  })

  // 別の space の一覧にこのタスクは無い。触ると表示されないタスクの数が端末の保存に残る
  it('別の space のコメント数キャッシュは触らない', async () => {
    commentsInsertResponse = { data: { ...commentRow, id: 'new-1' }, error: null }
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const otherSpaceKey = ['taskCommentCounts', 'space', 'space-2'] as const
    queryClient.setQueryData(otherSpaceKey, { 'task-9': 4 }, { updatedAt: 1_000 })

    const { result } = renderHook(
      () => useTaskComments({ orgId: 'org-1', spaceId: 'space-1', taskId: 'task-1' }),
      { wrapper: makeWrapper(queryClient) }
    )
    await waitFor(() => expect(result.current.comments).toHaveLength(1))

    await act(async () => {
      await result.current.createComment({ body: '新しいコメント' })
    })

    expect(queryClient.getQueryData(otherSpaceKey)).toEqual({ 'task-9': 4 })
    expect(queryClient.getQueryState(otherSpaceKey)?.dataUpdatedAt).toBe(1_000)
  })

  // ±1 で取得時刻を「今」にすると、古い数のキャッシュが取りたて扱いになり、次に開いても取り直さなくなる
  it('±1 してもキャッシュの取得時刻は変えない', async () => {
    commentsInsertResponse = { data: { ...commentRow, id: 'new-1' }, error: null }
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(spaceCountsKey, { 'task-1': 2 }, { updatedAt: 1_000 })
    queryClient.setQueryData(myCountsKey, { 'task-1': 5 }, { updatedAt: 2_000 })

    const { result } = renderHook(
      () => useTaskComments({ orgId: 'org-1', spaceId: 'space-1', taskId: 'task-1' }),
      { wrapper: makeWrapper(queryClient) }
    )
    await waitFor(() => expect(result.current.comments).toHaveLength(1))

    await act(async () => {
      await result.current.createComment({ body: '新しいコメント' })
    })

    expect(queryClient.getQueryData(spaceCountsKey)).toEqual({ 'task-1': 3 })
    expect(queryClient.getQueryState(spaceCountsKey)?.dataUpdatedAt).toBe(1_000)
    expect(queryClient.getQueryData(myCountsKey)).toEqual({ 'task-1': 6 })
    expect(queryClient.getQueryState(myCountsKey)?.dataUpdatedAt).toBe(2_000)
  })

  it('createComment が失敗したら、コメント数は増やす前の値のまま', async () => {
    commentsInsertResponse = { data: null, error: { message: 'insert boom' } }
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(spaceCountsKey, { 'task-1': 2 })

    const { result } = renderHook(
      () => useTaskComments({ orgId: 'org-1', spaceId: 'space-1', taskId: 'task-1' }),
      { wrapper: makeWrapper(queryClient) }
    )
    await waitFor(() => expect(result.current.comments).toHaveLength(1))

    await expect(
      act(async () => {
        await result.current.createComment({ body: '失敗するコメント' })
      })
    ).rejects.toThrow()

    expect(queryClient.getQueryData(spaceCountsKey)).toEqual({ 'task-1': 2 })
  })

  it('softDeleteComment 成功後、コメント数キャッシュが -1 される', async () => {
    commentsUpdateResponse = { error: null }
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(spaceCountsKey, { 'task-1': 2 })

    const { result } = renderHook(
      () => useTaskComments({ orgId: 'org-1', spaceId: 'space-1', taskId: 'task-1' }),
      { wrapper: makeWrapper(queryClient) }
    )
    await waitFor(() => expect(result.current.comments).toHaveLength(1))

    await act(async () => {
      await result.current.softDeleteComment(commentRow.id)
    })

    expect(queryClient.getQueryData(spaceCountsKey)).toEqual({ 'task-1': 1 })
  })

  it('softDeleteComment はコメント数を0未満にしない', async () => {
    commentsUpdateResponse = { error: null }
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(spaceCountsKey, { 'task-1': 0 })

    const { result } = renderHook(
      () => useTaskComments({ orgId: 'org-1', spaceId: 'space-1', taskId: 'task-1' }),
      { wrapper: makeWrapper(queryClient) }
    )
    await waitFor(() => expect(result.current.comments).toHaveLength(1))

    await act(async () => {
      await result.current.softDeleteComment(commentRow.id)
    })

    expect(queryClient.getQueryData(spaceCountsKey)).toEqual({ 'task-1': 0 })
  })

  it('softDeleteComment が失敗したら、コメント数は変えない', async () => {
    commentsUpdateResponse = { error: { message: 'update boom' } }
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(spaceCountsKey, { 'task-1': 3 })

    const { result } = renderHook(
      () => useTaskComments({ orgId: 'org-1', spaceId: 'space-1', taskId: 'task-1' }),
      { wrapper: makeWrapper(queryClient) }
    )
    await waitFor(() => expect(result.current.comments).toHaveLength(1))

    await expect(
      act(async () => {
        await result.current.softDeleteComment(commentRow.id)
      })
    ).rejects.toThrow()

    expect(queryClient.getQueryData(spaceCountsKey)).toEqual({ 'task-1': 3 })
  })

  it('コメント数キャッシュを開いていない(存在しない)場合は何もせず落ちない', async () => {
    commentsInsertResponse = { data: { ...commentRow, id: 'new-1' }, error: null }
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    // spaceCountsKey のキャッシュを一切作らない

    const { result } = renderHook(
      () => useTaskComments({ orgId: 'org-1', spaceId: 'space-1', taskId: 'task-1' }),
      { wrapper: makeWrapper(queryClient) }
    )
    await waitFor(() => expect(result.current.comments).toHaveLength(1))

    await act(async () => {
      await result.current.createComment({ body: '新しいコメント' })
    })

    expect(queryClient.getQueryData(spaceCountsKey)).toBeUndefined()
  })
})
