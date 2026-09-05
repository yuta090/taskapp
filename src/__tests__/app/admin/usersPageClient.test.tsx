import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import UsersPageClient, { type UserRow } from '@/app/admin/(panel)/users/UsersPageClient'

/**
 * 運営のユーザー管理画面。運営の旗はDB側で service role 限定にしたので、
 * 運営を後から増やす／外す操作はこの画面のボタン（→ PATCH /api/admin/users）で行う。
 * 楽観更新（押した瞬間に表示が変わる・保存ボタン無し）。失敗したら元に戻す。
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

const ME = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const ROWS: UserRow[] = [
  { id: ME, display_name: '運営A', email: 'admin@example.com', is_superadmin: true, memberships_count: 1, created_at: '2026-07-01' },
  { id: OTHER, display_name: '一般B', email: 'user@example.com', is_superadmin: false, memberships_count: 1, created_at: '2026-07-02' },
]

beforeEach(() => {
  vi.clearAllMocks()
})

describe('UsersPageClient 運営の付与・剥奪', () => {
  it('一般ユーザーの行に「管理者にする」があり、押すと PATCH され表示が管理者に変わる', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ userId: OTHER, isSuperadmin: true }) }))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('confirm', vi.fn(() => true))

    render(<UsersPageClient initialData={ROWS} currentUserId={ME} />)
    fireEvent.click(screen.getByRole('button', { name: '管理者にする' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/admin/users')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(String(init.body))).toEqual({ userId: OTHER, isSuperadmin: true })
    expect(await screen.findByRole('button', { name: '管理者を外す' })).toBeInTheDocument()
  })

  it('自分自身の行には剥奪ボタンを出さない', () => {
    vi.stubGlobal('fetch', vi.fn())
    render(<UsersPageClient initialData={ROWS} currentUserId={ME} />)
    // 運営は A(自分) だけなので「管理者を外す」は 0 個
    expect(screen.queryByRole('button', { name: '管理者を外す' })).toBeNull()
  })

  it('API が失敗したら表示を元に戻す', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: 'x' }) })))
    vi.stubGlobal('confirm', vi.fn(() => true))
    render(<UsersPageClient initialData={ROWS} currentUserId={ME} />)
    fireEvent.click(screen.getByRole('button', { name: '管理者にする' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '管理者にする' })).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: '管理者を外す' })).toBeNull()
  })
})
