import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { pendingInviteLabel, useSpacePendingInvites } from '@/lib/hooks/useSpacePendingInvites'

/** 担当者の選択肢に出す表示名。名前があれば名前、無ければメール。どちらも「招待中」と分かるようにする */
describe('pendingInviteLabel', () => {
  it('名前があれば名前に（招待中）を付ける', () => {
    expect(pendingInviteLabel({ id: 'i1', email: 'tabata@example.co.jp', inviteeName: '田畠', role: 'member' })).toBe('田畠（招待中）')
  })
  it('名前が無ければメールに（招待中）を付ける', () => {
    expect(pendingInviteLabel({ id: 'i1', email: 'tabata@example.co.jp', inviteeName: null, role: 'member' })).toBe('tabata@example.co.jp（招待中）')
  })
})

describe('useSpacePendingInvites', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('読み込み中は、描き直しても同じ空の一覧を返す（毎回新しい [] だと、タスク一覧の組み分けが毎回やり直しになる）', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const queryClient = new QueryClient()
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children)

    const { result, rerender } = renderHook(() => useSpacePendingInvites('space-1'), { wrapper })
    const first = result.current.pendingInvites
    rerender()

    expect(first).toEqual([])
    expect(result.current.pendingInvites).toBe(first)
  })
})
