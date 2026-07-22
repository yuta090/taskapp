import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { signOut: vi.fn() } }) }))

/** 変更前(フラット19項目)と完全一致すべきURL集合。1つでも欠けたら外部リンクが死ぬ。 */
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
  '/admin/cli-usage',
  '/admin/design-system',
]

function hrefsInOrder(): string[] {
  return screen
    .getAllByRole('link')
    .map((a) => a.getAttribute('href') ?? '')
    .filter(Boolean)
}

describe('AdminSidebar — ナビ体系', () => {
  it('19項目すべてのURLが変更前と完全一致する（外部の直リンクを壊さない）', () => {
    render(<AdminSidebar />)
    const hrefs = hrefsInOrder()
    expect(hrefs.slice().sort()).toEqual(EXPECTED_HREFS.slice().sort())
    expect(hrefs).toHaveLength(19)
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
