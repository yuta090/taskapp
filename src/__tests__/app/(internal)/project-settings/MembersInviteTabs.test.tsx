import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MembersSettings } from '@/app/(internal)/[orgId]/project/[spaceId]/settings/MembersSettings'

/** 招待するときの名前入力と、「返事待ち」「招待の履歴」タブ */
const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('sonner', () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }))
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
// RC-2: 役割の選択肢の絞り込み自体は別テスト（spaceRoles.test.ts /
// MembersSettings.roleOptions.test.tsx）で検証済み。ここでは招待・タブの挙動だけを見る
vi.mock('@/lib/hooks/useSpaceRow', () => ({
  useSpaceRow: () => ({ space: { agency_mode: false }, isPending: false }),
}))
vi.mock('@/lib/hooks/useOrgMembers', () => ({
  useOrgMembers: () => ({
    members: [],
    roleByUserId: new Map([['user-1', 'owner']]),
    isPending: false,
    isLoadingError: false,
    error: null,
  }),
}))
vi.mock('@/lib/hooks/useUserSpaces', () => ({
  useUserSpaces: () => ({ spaces: [{ id: 'space-1', role: 'admin' }], isPending: false, isLoadingError: false }),
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

  // 招待の役割は client | member。参加後の役割（管理者・編集者…）とは別の言葉なので、
  // 参加後の対応表を使うと 'member' が英語のまま出てしまう
  it('招待の役割は日本語で出す', async () => {
    await renderScreen()
    fireEvent.click(screen.getByRole('tab', { name: /返事待ち/ }))

    await waitFor(() => expect(screen.getByText('山田 太郎')).toBeInTheDocument())
    const row = screen.getByText('山田 太郎').closest('[data-testid="invite-row"]')!
    expect(within(row as HTMLElement).getByText('メンバー')).toBeInTheDocument()
    expect(screen.queryByText('member')).toBeNull()
  })

  // 期限を延ばす処理とメールを送る処理は別で、後者だけこけることがある。
  // それを「送りました」と言ってしまうと、届いていないことに誰も気づけない
  it('メールが送れなかったときは、送れたことにしない', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, email_sent: false, invite_url: 'https://agentpm.app/invite/tok-1' }),
    })
    await renderScreen()
    fireEvent.click(screen.getByRole('tab', { name: /返事待ち/ }))
    await waitFor(() => expect(screen.getByText('山田 太郎')).toBeInTheDocument())

    fireEvent.click(screen.getAllByRole('button', { name: 'もう一度送る' })[0])

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(String(toastError.mock.calls[0][0])).toMatch(/送れませんでした/)
  })

  it('メールが送れたときだけ、送れたと伝える', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, email_sent: true }),
    })
    await renderScreen()
    fireEvent.click(screen.getByRole('tab', { name: /返事待ち/ }))
    await waitFor(() => expect(screen.getByText('山田 太郎')).toBeInTheDocument())

    fireEvent.click(screen.getAllByRole('button', { name: 'もう一度送る' })[0])

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled())
    expect(toastError).not.toHaveBeenCalled()
  })

  it('返事待ちのタブに、もう一度送れることの案内を出す', async () => {
    await renderScreen()
    fireEvent.click(screen.getByRole('tab', { name: /返事待ち/ }))

    await waitFor(() => expect(screen.getByText('山田 太郎')).toBeInTheDocument())
    expect(screen.getByText(/メールが届いていないとき/)).toBeInTheDocument()
  })
})
