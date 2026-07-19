import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MessageTimeline } from '@/components/secretary/MessageTimeline'
import type { ChannelMessageRow } from '@/lib/hooks/useChannelTimeline'
import type { UserSpace } from '@/lib/hooks/useUserSpaces'

/**
 * MessageTimeline — 「以前のメッセージを読み込む」導線の配線と、
 * 履歴読み込み時に最下部へ飛ばない(既存の新規受信時のみ最下部追従する)挙動。
 * データ取得ロジック自体は useChannelTimeline.test.ts でカバー済みのためここではモックする。
 */

const mockUseChannelTimeline = vi.fn()
vi.mock('@/lib/hooks/useChannelTimeline', () => ({
  useChannelTimeline: (...args: unknown[]) => mockUseChannelTimeline(...args),
}))

function makeMessage(id: string): ChannelMessageRow {
  return {
    id,
    org_id: 'org-1',
    space_id: 'space-1',
    identity_id: null,
    account_id: null,
    channel: 'line',
    direction: 'inbound',
    actor: 'client',
    external_user_id: null,
    content_type: 'text',
    body: `body-${id}`,
    storage_path: null,
    status: 'received',
    error: null,
    redacted_at: null,
    occurred_at: '2026-07-19T01:00:00.000Z',
    created_at: '2026-07-19T01:00:00.000Z',
  }
}

const SPACE: UserSpace = { id: 'space-1', name: '相手先A' } as UserSpace

function baseHookValue(overrides: Partial<ReturnType<typeof mockUseChannelTimeline>> = {}) {
  return {
    messages: [makeMessage('m1'), makeMessage('m2')],
    isLoading: false,
    isRefreshing: false,
    error: null,
    refetch: vi.fn(),
    refreshLatest: vi.fn(),
    sendMessage: vi.fn().mockResolvedValue({ ok: true }),
    retryMessage: vi.fn(),
    fetchNextPage: vi.fn().mockResolvedValue(undefined),
    hasNextPage: false,
    isFetchingNextPage: false,
    ...overrides,
  }
}

// jsdomはレイアウト計算をしないため scrollTop/scrollHeight を手動で差し替え、
// 「最下部へジャンプしたか(=scrollHeightと同じ値になったか)」を検証可能にする。
let scrollTopValue = 0
let scrollHeightValue = 0
beforeEach(() => {
  scrollTopValue = 0
  scrollHeightValue = 0
  mockUseChannelTimeline.mockReset()
  Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
    configurable: true,
    get() {
      return scrollTopValue
    },
    set(v: number) {
      scrollTopValue = v
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get() {
      return scrollHeightValue
    },
  })
})

describe('MessageTimeline', () => {
  it('hasNextPage=falseのときは「以前のメッセージを読み込む」ボタンを出さない', () => {
    mockUseChannelTimeline.mockReturnValue(baseHookValue({ hasNextPage: false }))
    render(<MessageTimeline orgId="org-1" space={SPACE} isLinked />)
    expect(screen.queryByText('以前のメッセージを読み込む')).not.toBeInTheDocument()
  })

  it('hasNextPage=trueのときボタンを表示し、クリックでfetchNextPageを呼ぶ', () => {
    const fetchNextPage = vi.fn().mockResolvedValue(undefined)
    mockUseChannelTimeline.mockReturnValue(baseHookValue({ hasNextPage: true, fetchNextPage }))
    render(<MessageTimeline orgId="org-1" space={SPACE} isLinked />)

    const button = screen.getByText('以前のメッセージを読み込む')
    fireEvent.click(button)
    expect(fetchNextPage).toHaveBeenCalledTimes(1)
  })

  it('isFetchingNextPage=trueのときボタンは「読み込み中...」表示かつdisabled', () => {
    mockUseChannelTimeline.mockReturnValue(
      baseHookValue({ hasNextPage: true, isFetchingNextPage: true }),
    )
    render(<MessageTimeline orgId="org-1" space={SPACE} isLinked />)
    const button = screen.getByText('読み込み中...')
    expect(button).toBeDisabled()
  })

  it('新規メッセージ受信時(末尾追加)は最下部へ追従する', () => {
    mockUseChannelTimeline.mockReturnValue(
      baseHookValue({ messages: [makeMessage('m1'), makeMessage('m2')] }),
    )
    const { rerender } = render(<MessageTimeline orgId="org-1" space={SPACE} isLinked />)

    scrollHeightValue = 300
    mockUseChannelTimeline.mockReturnValue(
      baseHookValue({ messages: [makeMessage('m1'), makeMessage('m2'), makeMessage('m3')] }),
    )
    rerender(<MessageTimeline orgId="org-1" space={SPACE} isLinked />)

    expect(scrollTopValue).toBe(300)
  })

  it('「以前のメッセージを読み込む」クリック後は最下部へジャンプせず、useLayoutEffectで表示位置を保つ', () => {
    scrollHeightValue = 200
    scrollTopValue = 0
    const fetchNextPage = vi.fn().mockResolvedValue(undefined)
    mockUseChannelTimeline.mockReturnValue(
      baseHookValue({
        messages: [makeMessage('m1'), makeMessage('m2')],
        hasNextPage: true,
        fetchNextPage,
      }),
    )
    const { rerender } = render(<MessageTimeline orgId="org-1" space={SPACE} isLinked />)
    // mountの最下部追従effectでscrollTop=200(最下部)になっている。
    // ユーザーが履歴を遡るために上へスクロールした状態(中間位置)を模擬する。
    scrollTopValue = 50

    const button = screen.getByText('以前のメッセージを読み込む')
    // クリック時点のscrollHeight(200)がprevScrollHeightRefとして捕捉される
    fireEvent.click(button)
    expect(fetchNextPage).toHaveBeenCalledTimes(1)
    // 実際のfetch完了を待たず、クリック直後はまだscrollTopは変化しない
    expect(scrollTopValue).toBe(50)

    // 履歴読み込みで古いメッセージが先頭に積まれ、コンテンツの高さが増える
    scrollHeightValue = 400
    mockUseChannelTimeline.mockReturnValue(
      baseHookValue({
        messages: [makeMessage('m0'), makeMessage('m1'), makeMessage('m2')],
        hasNextPage: true,
        fetchNextPage,
      }),
    )
    act(() => {
      rerender(<MessageTimeline orgId="org-1" space={SPACE} isLinked />)
    })

    // useLayoutEffectがコミット後同期実行され、最下部へジャンプ(=400)せず、
    // 増えた分(400-200=200)だけずらした位置(50+200=250)になる
    expect(scrollTopValue).not.toBe(400)
    expect(scrollTopValue).toBe(250)
  })

  it('「最新へ」クリックでrefreshLatestを呼び、最下部へ戻す', () => {
    scrollHeightValue = 500
    scrollTopValue = 0
    const refreshLatest = vi.fn()
    mockUseChannelTimeline.mockReturnValue(baseHookValue({ refreshLatest }))
    render(<MessageTimeline orgId="org-1" space={SPACE} isLinked />)

    fireEvent.click(screen.getByTitle('最新のメッセージへ戻る'))

    expect(refreshLatest).toHaveBeenCalledTimes(1)
    expect(scrollTopValue).toBe(500)
  })
})
