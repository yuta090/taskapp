import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MembersSettings } from '@/app/(internal)/[orgId]/project/[spaceId]/settings/MembersSettings'

/** 招待するときの名前入力と、「返事待ち」「招待の履歴」タブ */
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/components/shared', async () => {
  // Hint（「?」の補足）は実物を使う
  const { Hint } = await import('@/components/shared/Hint')
  return {
    Hint,
    useConfirmDialog: () => ({ confirm: vi.fn().mockResolvedValue(true), ConfirmDialog: null }),
  }
})
vi.mock('@/lib/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { id: 'user-1' }, loading: false, error: null }),
}))
// 参加日は一覧とは別のクエリ。ここでは中身を見ないので空で返す
vi.mock('@/lib/hooks/useSpaceMemberJoinedAt', () => ({
  useSpaceMemberJoinedAt: () => null,
}))
vi.mock('@/lib/hooks/useSpaceMembers', () => ({
  useSpaceMembers: () => ({
    // 一覧はこのフックが正本。自分の役割（=招待できるか）もここから決まる
    members: [{ id: 'user-1', displayName: '自分', avatarUrl: null, role: 'admin' }],
    loading: false,
    isPending: false,
    error: null,
    refetch: vi.fn(),
    patchMembers: vi.fn(() => () => {}),
  }),
}))
vi.mock('@/lib/hooks/useInviteTemplate', () => ({
  useInviteTemplate: () => ({ template: null, loading: false, error: null, refresh: vi.fn() }),
}))

const invites = [
  {
    id: 'inv-1',
    email: 'a@example.com',
    invitee_name: '山田 太郎',
    role: 'member',
    space_id: 'space-1',
    space_name: 'テスト',
    created_at: '2026-09-01T00:00:00Z',
    expires_at: '2026-12-01T00:00:00Z',
    accepted_at: null,
    status: 'pending' as const,
  },
  {
    id: 'inv-2',
    email: 'b@example.com',
    invitee_name: null,
    role: 'client',
    space_id: 'space-1',
    space_name: 'テスト',
    created_at: '2026-06-01T00:00:00Z',
    expires_at: '2026-07-01T00:00:00Z',
    accepted_at: null,
    status: 'expired' as const,
  },
]
let canManage = true
const refreshInvites = vi.fn()
const useSpaceInvitesMock = vi.fn()
vi.mock('@/lib/hooks/useSpaceInvites', () => ({
  useSpaceInvites: (...args: unknown[]) => {
    useSpaceInvitesMock(...args)
    return { invites, canManage, loading: false, error: null, refresh: refreshInvites }
  },
}))

const mockGetUser = vi.fn()
const mockRpc = vi.fn()
const mockFrom = vi.fn()
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getUser: (...args: unknown[]) => mockGetUser(...args) },
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}))

const fetchMock = vi.fn()

async function renderScreen() {
  render(<MembersSettings orgId="org-1" spaceId="space-1" />)
  await waitFor(() => expect(screen.getByText('メンバーを招待')).toBeInTheDocument())
}

beforeEach(() => {
  vi.clearAllMocks()
  canManage = true
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
  mockFrom.mockReturnValue({ select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) })
  mockRpc.mockImplementation((fn: string) => {
    if (fn === 'rpc_get_space_members') {
      return Promise.resolve({
        data: [{ user_id: 'user-1', display_name: '自分', avatar_url: null, role: 'admin' }],
        error: null,
      })
    }
    return Promise.resolve({ data: null, error: null })
  })
  fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ token: 'tok', email_sent: true }) })
  vi.stubGlobal('fetch', fetchMock)
})

describe('招待するときの名前', () => {
  it('入力した名前が招待に載る', async () => {
    await renderScreen()
    fireEvent.change(screen.getByLabelText('名前（任意）'), { target: { value: '山田 太郎' } })
    fireEvent.change(screen.getByLabelText('メールアドレス'), { target: { value: 'a@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: '招待' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/invites', expect.anything()))
    const body = JSON.parse(fetchMock.mock.calls.find((c) => c[0] === '/api/invites')![1].body)
    expect(body.name).toBe('山田 太郎')
  })

  it('空のままなら名前は送らない', async () => {
    await renderScreen()
    fireEvent.change(screen.getByLabelText('メールアドレス'), { target: { value: 'a@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: '招待' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/invites', expect.anything()))
    const body = JSON.parse(fetchMock.mock.calls.find((c) => c[0] === '/api/invites')![1].body)
    expect(body.name).toBeUndefined()
  })
})

describe('返事待ち・履歴のタブ', () => {
  it('はじめはメンバーのタブで、招待は読みに行かない', async () => {
    await renderScreen()
    expect(useSpaceInvitesMock).toHaveBeenCalledWith('space-1', 'pending', false)
  })

  it('「返事待ち」を開くと返事待ちの招待が出る', async () => {
    await renderScreen()
    fireEvent.click(screen.getByRole('tab', { name: /返事待ち/ }))

    await waitFor(() => expect(useSpaceInvitesMock).toHaveBeenCalledWith('space-1', 'pending', true))
    expect(screen.getByText('山田 太郎')).toBeInTheDocument()
  })

  it('「招待の履歴」は期限切れも含めて読む', async () => {
    await renderScreen()
    fireEvent.click(screen.getByRole('tab', { name: /招待の履歴/ }))

    await waitFor(() => expect(useSpaceInvitesMock).toHaveBeenCalledWith('space-1', 'all', true))
    expect(screen.getByText('期限切れ')).toBeInTheDocument()
  })

  it('期限切れの招待をもう一度送れる', async () => {
    await renderScreen()
    fireEvent.click(screen.getByRole('tab', { name: /招待の履歴/ }))
    await waitFor(() => expect(screen.getByText('期限切れ')).toBeInTheDocument())

    fireEvent.click(screen.getAllByRole('button', { name: 'もう一度送る' })[1])

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/invites/pending/inv-2/resend', { method: 'POST' })
    )
    expect(refreshInvites).toHaveBeenCalled()
  })

  it('取り消せる権限が無ければ、送り直し・取り消しは出さない', async () => {
    canManage = false
    await renderScreen()
    fireEvent.click(screen.getByRole('tab', { name: /返事待ち/ }))

    await waitFor(() => expect(screen.getByText('山田 太郎')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'もう一度送る' })).toBeNull()
  })

  // アイコンだけのボタンは見つけてもらえなかった（実際に「再送ボタンが見当たらない」と言われた）。
  // マウスを乗せないと分からない tooltip ではなく、字が出ていることを保証する
  it('送り直し・取り消しは、字の出ているボタンにする', async () => {
    await renderScreen()
    fireEvent.click(screen.getByRole('tab', { name: /返事待ち/ }))

    await waitFor(() => expect(screen.getByText('山田 太郎')).toBeInTheDocument())
    expect(screen.getAllByRole('button', { name: 'もう一度送る' })).toHaveLength(invites.length)
    expect(screen.getAllByRole('button', { name: '招待を取り消す' })).toHaveLength(invites.length)
  })

  it('返事待ちのタブに、もう一度送れることの案内を出す', async () => {
    await renderScreen()
    fireEvent.click(screen.getByRole('tab', { name: /返事待ち/ }))

    await waitFor(() => expect(screen.getByText('山田 太郎')).toBeInTheDocument())
    expect(screen.getByText(/メールが届いていないとき/)).toBeInTheDocument()
  })
})
