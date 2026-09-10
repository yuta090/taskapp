import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { AdminSidebar } from '@/components/admin/AdminSidebar'

/**
 * 運営パネルのナビ体系（Fable裁定 2026-07-22: 業務フロー×頻度の4群＋件数バッジ）。
 *
 * ここで守りたい不変条件は2つ:
 *   1. **URLを1つも変えない/落とさない** — 申込通知メールに載る /admin/shared-bot-access など、
 *      外部から張られた直リンクが死ぬため。
 *   2. 収益の律速である「共通LINE開通」が最上段にあり、未処理件数がバッジで判ること。
 */

vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/dashboard',
  useRouter: () => ({ push: vi.fn() }),
}))

const { mockSignOutAndLeave } = vi.hoisted(() => ({
  mockSignOutAndLeave: vi.fn(() => Promise.resolve()),
}))
vi.mock('@/lib/auth/signOutClient', () => ({
  signOutAndLeave: mockSignOutAndLeave,
}))

/** 変更前(フラット19項目)＋追加分と完全一致すべきURL集合。1つでも欠けたら外部リンクが死ぬ。 */
const EXPECTED_HREFS = [
  '/admin/dashboard',
  '/admin/tables',
  '/admin/users',
  '/admin/organizations',
  '/admin/spaces',
  '/admin/invites',
  '/admin/billing',
  '/admin/api-keys',
  '/admin/logs',
  '/admin/notifications',
  '/admin/announcements',
  '/admin/blog',
  '/admin/reviews',
  '/admin/analytics',
  '/admin/sitemap',
  '/admin/integrations',
  '/admin/shared-bot-access',
  // 枠追加のお見積もり（2026-07-26 追加）。既存URLは1つも変えていない。
  '/admin/quotes',
  '/admin/cli-usage',
  '/admin/design-system',
  // メール文面（2026-09-07 追加）。招待メールの文面を運営が編集する。
  '/admin/email-templates',
]

function hrefsInOrder(): string[] {
  return screen
    .getAllByRole('link')
    .map((a) => a.getAttribute('href') ?? '')
    .filter(Boolean)
}

describe('AdminSidebar — ナビ体系', () => {
  it('既存19項目のURLが1つも欠けない（外部の直リンクを壊さない）', () => {
    render(<AdminSidebar />)
    const hrefs = hrefsInOrder()
    expect(hrefs.slice().sort()).toEqual(EXPECTED_HREFS.slice().sort())
    expect(hrefs).toHaveLength(EXPECTED_HREFS.length)
  })

  it('4つのグループ見出しを出す', () => {
    render(<AdminSidebar />)
    for (const heading of ['運用', '顧客', 'マーケ・コンテンツ', '開発者ツール']) {
      expect(screen.getByText(heading)).toBeInTheDocument()
    }
  })

  it('収益の律速である「共通LINE開通」が最上段に来る', () => {
    render(<AdminSidebar />)
    expect(hrefsInOrder()[0]).toBe('/admin/shared-bot-access')
  })

  it('件数バッジは1以上のときだけ出す', () => {
    render(<AdminSidebar badges={{ '/admin/shared-bot-access': 3, '/admin/reviews': 0 }} />)
    expect(screen.getByTestId('admin-nav-badge-/admin/shared-bot-access')).toHaveTextContent('3')
    expect(screen.queryByTestId('admin-nav-badge-/admin/reviews')).not.toBeInTheDocument()
  })

  it('99超は 99+ に丸める', () => {
    render(<AdminSidebar badges={{ '/admin/notifications': 150 }} />)
    expect(screen.getByTestId('admin-nav-badge-/admin/notifications')).toHaveTextContent('99+')
  })

  it('badges 未指定でも落ちない（バッジ無しで描画）', () => {
    render(<AdminSidebar />)
    expect(screen.queryByTestId('admin-nav-badge-/admin/shared-bot-access')).not.toBeInTheDocument()
  })
})

/**
 * 折りたたみ（2026-09-07 追加）: メール文面のプレビューなど横幅が要る画面で、
 * サイドバーをアイコンだけに畳んで作業領域を広げる。畳んでも URL は1つも減らない。
 */
describe('AdminSidebar — 折りたたみ', () => {
  beforeEach(() => {
    try {
      window.localStorage.clear()
    } catch {
      /* noop */
    }
  })

  it('既定は広げた状態で、畳むボタンを押すとアイコンだけになる（リンクは全部残る）', async () => {
    render(<AdminSidebar />)
    const aside = screen.getByTestId('admin-sidebar')
    expect(aside).toHaveAttribute('data-collapsed', 'false')
    expect(screen.getByText('組織管理')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'メニューを畳む' }))
    expect(aside).toHaveAttribute('data-collapsed', 'true')
    expect(screen.queryByText('マーケ・コンテンツ')).not.toBeInTheDocument()
    // ラベルは消えるが、リンク自体（URL）は全部残る。ツールチップで名前が分かる
    expect(hrefsInOrder().slice().sort()).toEqual(EXPECTED_HREFS.slice().sort())
    expect(screen.getByRole('link', { name: /組織管理/ })).toHaveAttribute('title', '組織管理')

    fireEvent.click(screen.getByRole('button', { name: 'メニューを広げる' }))
    expect(aside).toHaveAttribute('data-collapsed', 'false')
  })

  it('畳んだ状態は次回も覚えている（localStorage）', async () => {
    const { unmount } = render(<AdminSidebar />)
    fireEvent.click(screen.getByRole('button', { name: 'メニューを畳む' }))
    unmount()
    render(<AdminSidebar />)
    await waitFor(() => expect(screen.getByTestId('admin-sidebar')).toHaveAttribute('data-collapsed', 'true'))
  })

  it('サーバー描画(SSR)は cookie 由来の initialCollapsed で最初から畳んだ状態を出す（初回のガタつき防止）', () => {
    const html = renderToString(<AdminSidebar initialCollapsed />)
    expect(html).toContain('data-collapsed="true"')
    expect(renderToString(<AdminSidebar />)).toContain('data-collapsed="false"')
  })

  it('端末に記憶が無いときは cookie に合わせる（サーバー描画と食い違わない）', () => {
    document.cookie = 'admin-sidebar-collapsed=1; path=/'
    render(<AdminSidebar initialCollapsed />)
    expect(screen.getByTestId('admin-sidebar')).toHaveAttribute('data-collapsed', 'true')
    document.cookie = 'admin-sidebar-collapsed=0; path=/'
  })

  it('畳んでも件数バッジは見える', async () => {
    render(<AdminSidebar badges={{ '/admin/shared-bot-access': 3 }} />)
    fireEvent.click(screen.getByRole('button', { name: 'メニューを畳む' }))
    expect(screen.getByTestId('admin-nav-badge-/admin/shared-bot-access')).toHaveTextContent('3')
  })
})

/**
 * ログアウトは signOutAndLeave に集約する（router.push はしない。signOutAndLeave 自身が
 * window.location.replace でフルページ遷移する）。push解除(cleanupPushOnLogout)は運営パネルの
 * ログアウトでは不要なので pushCleanup:false を渡す。
 */
describe('AdminSidebar — ログアウト', () => {
  beforeEach(() => {
    mockSignOutAndLeave.mockClear()
  })

  it('ログアウトを押すと signOutAndLeave({ to: "/admin/login", pushCleanup: false }) を呼ぶ', async () => {
    render(<AdminSidebar />)
    fireEvent.click(screen.getByRole('button', { name: 'ログアウト' }))

    await waitFor(() => {
      expect(mockSignOutAndLeave).toHaveBeenCalledWith({ to: '/admin/login', pushCleanup: false })
    })
  })
})
