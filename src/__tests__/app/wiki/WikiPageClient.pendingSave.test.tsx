import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { WikiPageClient } from '@/app/(internal)/[orgId]/project/[spaceId]/wiki/WikiPageClient'
import type { WikiPage } from '@/types/database'

/**
 * 自動保存は1.5秒待ってから書き込む。その待ち時間の途中で画面を移ると、最後の一手が
 * 保存されないまま消える。本文中のリンクを押すときは、移る前に確定させる。
 *
 * **どのページの本文かを覚えておくこと**が肝心。覚えないと、ページを切り替えたあとに
 * 確定したときに、前のページの本文で今のページを丸ごと上書きしてしまう。
 */

function page(overrides: Partial<WikiPage> = {}): WikiPage {
  return {
    id: 'p1',
    org_id: 'org1',
    space_id: 'space1',
    title: 'ページ1',
    body: '',
    tags: [],
    parent_page_id: null,
    milestone_id: null,
    pinned_at: null,
    sort_order: null,
    created_by: 'user1',
    updated_by: 'user1',
    created_at: '2026-09-01T00:00:00+09:00',
    updated_at: '2026-09-01T00:00:00+09:00',
    ...overrides,
  }
}

const PAGE_A = page({ id: 'p1', title: 'ページA' })

vi.mock('@/lib/hooks/useAnnouncements', () => ({
  useAnnouncements: () => ({
    announcements: [],
    unreadCount: 0,
    markAsRead: vi.fn(),
    markAllAsRead: vi.fn(),
  }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams('page=p1'),
}))

// 実物と同じく安定参照にする（毎レンダー新しい fn だと、それに依存する effect が余計に走る）
const mockSetInspector = vi.hoisted(() => vi.fn())
vi.mock('@/components/layout', async () => {
  const React = await import('react')
  return {
    useInspector: () => ({ setInspector: mockSetInspector }),
    useShellFullscreen: () => {
      const [fullscreen, setFullscreen] = React.useState(false)
      return { fullscreen, setFullscreen }
    },
  }
})

vi.mock('@/lib/hooks/useIsMobile', () => ({ useIsMobile: () => false }))

const mockUpdatePage = vi.hoisted(() => vi.fn())
const mockFetchPage = vi.hoisted(() => vi.fn())
vi.mock('@/lib/hooks/useWikiPages', () => ({
  useWikiPages: () => ({
    pages: [PAGE_A],
    loading: false,
    autoCreatedPageId: null,
    fetchPages: vi.fn(),
    createPage: vi.fn(),
    updatePage: mockUpdatePage,
    deletePage: vi.fn(),
    fetchPage: mockFetchPage,
    fetchVersions: vi.fn(),
  }),
}))

vi.mock('@/lib/hooks/useMilestones', () => ({ useMilestones: () => ({ milestones: [], loading: false }) }))
vi.mock('@/lib/hooks/useSpaceMembers', () => ({ useSpaceMembers: () => ({ members: [] }) }))
vi.mock('@/lib/hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ user: { id: 'user1' } }) }))
vi.mock('@/lib/hooks/useCanEditSpace', () => ({ useCanEditSpace: () => ({ canEdit: true, loading: false }) }))
vi.mock('@/lib/hooks/useWikiMilestoneLinks', () => ({
  useWikiMilestoneLinks: () => ({ linksByPageId: new Map(), loading: false }),
}))
vi.mock('@/components/wiki/WikiPageInspector', () => ({
  WikiPageInspector: () => <div data-testid="wiki-page-inspector-stub" />,
}))

const mockToastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { error: mockToastError, success: vi.fn() } }))

// エディタは実体（BlockNote）を使わず、「入力した」と「リンクを押した」を起こせるスタブにする
const captured = vi.hoisted(() => ({ onBeforeNavigate: null as null | (() => Promise<void> | void) }))
vi.mock('@/components/wiki/WikiEditorDynamic', async () => {
  const React = await import('react')
  return {
    WikiEditorDynamic: ({
      onChange,
      onBeforeNavigate,
    }: {
      onChange?: (content: string) => void
      onBeforeNavigate?: () => Promise<void> | void
    }) => {
      captured.onBeforeNavigate = onBeforeNavigate ?? null
      return React.createElement(
        'div',
        { 'data-testid': 'wiki-editor-stub' },
        React.createElement(
          'button',
          { type: 'button', 'data-testid': 'type-a', onClick: () => onChange?.('ページAの本文') },
          '入力'
        )
      )
    },
  }
})

async function renderOpened() {
  mockFetchPage.mockResolvedValue(PAGE_A)
  render(<WikiPageClient orgId="org1" spaceId="space1" />)
  await waitFor(() => expect(screen.getByTestId('wiki-editor-stub')).toBeInTheDocument())
  // 画面が出てから時間を止める。最初から止めると、ページの読み込み待ちが進まない
  vi.useFakeTimers()
}

beforeEach(() => {
  vi.clearAllMocks()
  captured.onBeforeNavigate = null
  mockUpdatePage.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('WikiPageClient — 移る前に保存を確定させる', () => {
  it('リンクを押す前に、待っている本文をそのページ宛てに保存する', async () => {
    await renderOpened()

    fireEvent.click(screen.getByTestId('type-a'))
    expect(mockUpdatePage).not.toHaveBeenCalled()

    await act(async () => {
      await captured.onBeforeNavigate?.()
    })

    expect(mockUpdatePage).toHaveBeenCalledWith('p1', { body: 'ページAの本文' })
  })

  it('1.5秒たてば、押さなくても保存する（今までどおり）', async () => {
    await renderOpened()

    fireEvent.click(screen.getByTestId('type-a'))
    await act(async () => {
      vi.advanceTimersByTime(1600)
    })

    expect(mockUpdatePage).toHaveBeenCalledWith('p1', { body: 'ページAの本文' })
  })

  it('同じ中身を二重に保存しない', async () => {
    await renderOpened()

    fireEvent.click(screen.getByTestId('type-a'))
    await act(async () => {
      await captured.onBeforeNavigate?.()
      vi.advanceTimersByTime(1600)
    })

    expect(mockUpdatePage).toHaveBeenCalledTimes(1)
  })

  it('保存できなかったときは、移動を止めるために例外を投げて知らせる', async () => {
    await renderOpened()
    mockUpdatePage.mockRejectedValueOnce(new Error('通信できません'))

    fireEvent.click(screen.getByTestId('type-a'))

    await expect(
      act(async () => {
        await captured.onBeforeNavigate?.()
      })
    ).rejects.toThrow()
    expect(mockToastError).toHaveBeenCalled()
  })

  it('待っている本文が無ければ、何も書き込まない', async () => {
    await renderOpened()

    await act(async () => {
      await captured.onBeforeNavigate?.()
    })

    expect(mockUpdatePage).not.toHaveBeenCalled()
  })
})
