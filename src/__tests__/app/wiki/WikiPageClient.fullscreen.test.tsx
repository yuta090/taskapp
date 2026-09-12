import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { WikiPageClient } from '@/app/(internal)/[orgId]/project/[spaceId]/wiki/WikiPageClient'
import type { WikiPage } from '@/types/database'

// Wiki ページを開いた状態(全画面ボタン付きのエディタ画面)での配線を確かめる統合テスト。
// - ページ情報パネルが narrow(320px) で開くこと
// - 全画面トグルでインスペクターが閉じ、閉じるボタン/Escで復帰すること
// - 全画面の切り替えでエディタが再マウントされない(=入力中の内容やカーソルが消えない)こと

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

const ACTIVE_PAGE = page({ id: 'p1', title: '開いているページ' })

// お知らせベルの取得層(react-query)を差し替える。無いと QueryClientProvider 無しで落ちる。
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

const mockSetInspector = vi.fn()
// 全画面は AppShell の状態（デスクトップの LeftNav を隠す）。ここでは1画面分の state で代用し、
// 呼び出しを mockSetShellFullscreen で見る
const mockSetShellFullscreen = vi.hoisted(() => vi.fn())
vi.mock('@/components/layout', async () => {
  const React = await import('react')
  return {
    useInspector: () => ({ setInspector: mockSetInspector }),
    useShellFullscreen: () => {
      const [fullscreen, setLocal] = React.useState(false)
      const setFullscreen = React.useCallback((value: boolean) => {
        mockSetShellFullscreen(value)
        setLocal(value)
      }, [])
      return { fullscreen, setFullscreen }
    },
  }
})

vi.mock('@/lib/hooks/useIsMobile', () => ({ useIsMobile: () => false }))

// フックの戻り値の関数は実物と同じく安定参照にする（毎レンダー新しい fn だと、
// それに依存する WikiPageClient 内の useEffect が意図せず再発火し、全画面state等がリセットされる）
const mockFetchPage = vi.hoisted(() => vi.fn())
vi.mock('@/lib/hooks/useWikiPages', () => ({
  useWikiPages: () => ({
    pages: [ACTIVE_PAGE],
    loading: false,
    autoCreatedPageId: null,
    fetchPages: vi.fn(),
    createPage: vi.fn(),
    updatePage: vi.fn().mockResolvedValue(undefined),
    deletePage: vi.fn(),
    fetchPage: mockFetchPage,
    fetchVersions: vi.fn(),
  }),
}))

vi.mock('@/lib/hooks/useMilestones', () => ({
  useMilestones: () => ({ milestones: [], loading: false }),
}))

vi.mock('@/lib/hooks/useSpaceMembers', () => ({
  useSpaceMembers: () => ({ members: [] }),
}))

vi.mock('@/lib/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { id: 'user1' } }),
}))

vi.mock('@/lib/hooks/useCanEditSpace', () => ({
  useCanEditSpace: () => ({ canEdit: true, loading: false }),
}))

vi.mock('@/lib/hooks/useWikiMilestoneLinks', () => ({
  useWikiMilestoneLinks: () => ({ linksByPageId: new Map(), loading: false }),
}))

// WikiPageInspector は中身を問わないのでスタブに差し替える(このテストは setInspector への
// 呼び出し引数(narrow指定・null)だけを見る)
vi.mock('@/components/wiki/WikiPageInspector', () => ({
  WikiPageInspector: () => <div data-testid="wiki-page-inspector-stub" />,
}))

// エディタは実体(BlockNote)を使わず、マウント回数を数えるだけのスタブに差し替える。
// useEffect(..., []) で数えることで「レンダー回数」ではなく「マウント回数」を見る
// （再マウントなら unmount→mount で再度 effect が走り直り、className だけの更新では走らない）。
// 全画面の切替でこのマウント数が増えなければ「再マウントしていない」ことの証明になる。
const mountCount = vi.hoisted(() => ({ current: 0 }))
vi.mock('@/components/wiki/WikiEditorDynamic', async () => {
  const React = await import('react')
  return {
    WikiEditorDynamic: ({ onChange }: { onChange?: (content: string) => void }) => {
      React.useEffect(() => {
        mountCount.current += 1
      }, [])
      // 「入力した」ことにするボタン（保存の状態表示を確かめるため）
      return React.createElement(
        'div',
        { 'data-testid': 'wiki-editor-stub' },
        React.createElement(
          'button',
          { type: 'button', 'data-testid': 'wiki-editor-stub-type', onClick: () => onChange?.('変更後の本文') },
          '入力'
        )
      )
    },
  }
})

// activePage は fetchPage(非同期) を待ってから effect で確定するため、
// 描画直後は編集画面がまだ出ない。エディタのスタブに加えて、後続の
// 「ページ情報パネルを narrow で開く」effect の実行まで両方そろうのを待つ
// （DOM反映とeffectのフラッシュは別タイミングで起こり得るため、片方だけ待つと不安定になる）。
async function setup() {
  render(<WikiPageClient orgId="org1" spaceId="space1" />)
  await waitFor(() => {
    expect(screen.getByTestId('wiki-editor-stub')).toBeInTheDocument()
    expect(mockSetInspector.mock.calls.at(-1)?.[1]).toEqual({ size: 'narrow' })
  })
}

describe('WikiPageClient 全画面表示（PR: ページを広く読みたい）', () => {
  beforeEach(() => {
    mockSetInspector.mockClear()
    mountCount.current = 0
    mockFetchPage.mockReset().mockResolvedValue(ACTIVE_PAGE)
  })

  it('ページを開くと、ページ情報パネルが narrow サイズで開く', async () => {
    await setup()
    const lastCall = mockSetInspector.mock.calls.at(-1)
    expect(lastCall?.[1]).toEqual({ size: 'narrow' })
  })

  it('全画面ボタンを押すと全画面表示になり、インスペクターを閉じる', async () => {
    await setup()
    const toggle = screen.getByTestId('wiki-fullscreen-toggle')
    expect(toggle).toHaveAttribute('aria-pressed', 'false')

    mockSetInspector.mockClear()
    fireEvent.click(toggle)

    // インスペクターは閉じる
    expect(mockSetInspector).toHaveBeenCalledWith(null)
    // 全画面を閉じるボタンに切り替わる
    expect(screen.getByTestId('wiki-fullscreen-close')).toBeInTheDocument()
    expect(screen.queryByTestId('wiki-fullscreen-toggle')).not.toBeInTheDocument()
  })

  it('「全画面を閉じる」ボタンで戻ると、ページ情報パネルが narrow サイズで復帰する', async () => {
    await setup()
    fireEvent.click(screen.getByTestId('wiki-fullscreen-toggle'))
    mockSetInspector.mockClear()

    fireEvent.click(screen.getByTestId('wiki-fullscreen-close'))

    expect(screen.getByTestId('wiki-fullscreen-toggle')).toBeInTheDocument()
    const lastCall = mockSetInspector.mock.calls.at(-1)
    expect(lastCall?.[1]).toEqual({ size: 'narrow' })
  })

  it('Escキーで全画面表示を終了し、ページ情報パネルが復帰する', async () => {
    await setup()
    fireEvent.click(screen.getByTestId('wiki-fullscreen-toggle'))
    expect(screen.getByTestId('wiki-fullscreen-close')).toBeInTheDocument()
    mockSetInspector.mockClear()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.getByTestId('wiki-fullscreen-toggle')).toBeInTheDocument()
    const lastCall = mockSetInspector.mock.calls.at(-1)
    expect(lastCall?.[1]).toEqual({ size: 'narrow' })
  })

  it('IME変換中のEscや、既に処理済みのEscでは全画面表示を終了しない', async () => {
    await setup()
    fireEvent.click(screen.getByTestId('wiki-fullscreen-toggle'))
    expect(screen.getByTestId('wiki-fullscreen-close')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape', isComposing: true })
    expect(screen.getByTestId('wiki-fullscreen-close')).toBeInTheDocument()

    const defaultPreventedEvent = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    defaultPreventedEvent.preventDefault()
    document.dispatchEvent(defaultPreventedEvent)
    expect(screen.getByTestId('wiki-fullscreen-close')).toBeInTheDocument()
  })

  it('全画面の切り替えでエディタが再マウントされない', async () => {
    await setup()
    expect(mountCount.current).toBe(1)

    fireEvent.click(screen.getByTestId('wiki-fullscreen-toggle'))
    expect(mountCount.current).toBe(1)

    fireEvent.click(screen.getByTestId('wiki-fullscreen-close'))
    expect(mountCount.current).toBe(1)
  })

  it('全画面は画面の枠（AppShell）に頼んで LeftNav を隠す（重ね表示にしない）', async () => {
    await setup()
    mockSetShellFullscreen.mockClear()

    fireEvent.click(screen.getByTestId('wiki-fullscreen-toggle'))
    expect(mockSetShellFullscreen).toHaveBeenLastCalledWith(true)

    fireEvent.click(screen.getByTestId('wiki-fullscreen-close'))
    expect(mockSetShellFullscreen).toHaveBeenLastCalledWith(false)
  })

  it('Wiki の画面を離れたら全画面を解除する（ほかの画面で LeftNav が消えたままにならない）', async () => {
    const { unmount } = render(<WikiPageClient orgId="org1" spaceId="space1" />)
    await waitFor(() => expect(screen.getByTestId('wiki-editor-stub')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('wiki-fullscreen-toggle'))
    mockSetShellFullscreen.mockClear()

    unmount()

    expect(mockSetShellFullscreen).toHaveBeenCalledWith(false)
  })

  it('全画面で書いていても、入力すると「保存中...」が見える', async () => {
    await setup()
    fireEvent.click(screen.getByTestId('wiki-fullscreen-toggle'))

    fireEvent.click(screen.getByTestId('wiki-editor-stub-type'))

    expect(screen.getByText('保存中...')).toBeInTheDocument()
  })
})
