import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useDefaultReviewers } from '@/lib/hooks/useDefaultReviewers'

// 保存した内容がそのまま読み戻る、ごく小さな偽DB。
// 保存後に react-query が読み直すため、固定値を返す mock だと
// 「保存したのに古い値が戻る」だけの見せかけの失敗になる。
let stored: string[] | null = []
let updateFails = false

const singleMock = vi.fn(async () => ({ data: { default_reviewer_ids: stored }, error: null }))
const updateEqMock = vi.fn(async () => {
  if (updateFails) return { error: { message: 'boom' } }
  return { error: null }
})
const updateMock = vi.fn((patch: { default_reviewer_ids: string[] }) => {
  if (!updateFails) stored = patch.default_reviewer_ids
  return { eq: updateEqMock }
})
const fromMock = vi.fn(() => ({
  select: () => ({ eq: () => ({ single: singleMock }) }),
  update: updateMock,
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: fromMock }),
}))

const SPACE = 'space-1'

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

beforeEach(() => {
  stored = []
  updateFails = false
  singleMock.mockClear()
  updateMock.mockClear()
  updateEqMock.mockClear()
  fromMock.mockClear()
})

describe('useDefaultReviewers', () => {
  it('spaces から既定の承認者を読み込む', async () => {
    stored = ['a', 'b']
    const { result } = renderHook(() => useDefaultReviewers(SPACE), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.defaultReviewerIds).toEqual(['a', 'b'])
  })

  it('未設定(null)なら空配列', async () => {
    stored = null
    const { result } = renderHook(() => useDefaultReviewers(SPACE), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.defaultReviewerIds).toEqual([])
  })

  it('チェックを付けると、その人を足した配列で spaces を更新する', async () => {
    stored = ['a']
    const { result } = renderHook(() => useDefaultReviewers(SPACE), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.defaultReviewerIds).toEqual(['a']))

    await act(async () => {
      await result.current.setDefaultReviewer('b', true)
    })

    expect(updateMock).toHaveBeenCalledWith({ default_reviewer_ids: ['a', 'b'] })
    expect(updateEqMock).toHaveBeenCalledWith('id', SPACE)
    await waitFor(() => expect(result.current.defaultReviewerIds).toEqual(['a', 'b']))
  })

  it('チェックを外すと、その人を抜いた配列で更新する', async () => {
    stored = ['a', 'b']
    const { result } = renderHook(() => useDefaultReviewers(SPACE), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.defaultReviewerIds).toEqual(['a', 'b']))

    await act(async () => {
      await result.current.setDefaultReviewer('a', false)
    })

    expect(updateMock).toHaveBeenCalledWith({ default_reviewer_ids: ['b'] })
  })

  it('保存に失敗したら元の状態へ戻す', async () => {
    stored = ['a']
    updateFails = true
    const { result } = renderHook(() => useDefaultReviewers(SPACE), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.defaultReviewerIds).toEqual(['a']))

    await act(async () => {
      await result.current.setDefaultReviewer('b', true).catch(() => {})
    })

    await waitFor(() => expect(result.current.defaultReviewerIds).toEqual(['a']))
  })

  it('spaceId が無いときは取得しない', async () => {
    renderHook(() => useDefaultReviewers(null), { wrapper: createWrapper() })
    expect(fromMock).not.toHaveBeenCalled()
  })
})
