import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react'
import MembersSettingsPage from '@/app/settings/members/page'

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

const mockUseCurrentOrg = vi.fn()
vi.mock('@/lib/hooks/useCurrentOrg', () => ({
  useCurrentOrg: () => mockUseCurrentOrg(),
}))

const mockUseCurrentUser = vi.fn()
vi.mock('@/lib/hooks/useCurrentUser', () => ({
  useCurrentUser: () => mockUseCurrentUser(),
}))

const mockUseUserSpaces = vi.fn()
vi.mock('@/lib/hooks/useUserSpaces', () => ({
  useUserSpaces: (...args: unknown[]) => mockUseUserSpaces(...args),
}))

const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}))

const mockRpc = vi.fn()
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    rpc: (...args: unknown[]) => mockRpc(...args),
  }),
}))

vi.stubGlobal('confirm', vi.fn(() => true))

describe('MembersSettingsPage invite form', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()

    mockUseCurrentOrg.mockReturnValue({
      orgId: 'org-123',
      orgName: 'Test Org',
      role: 'owner',
      loading: false,
      error: null,
    })

    mockUseCurrentUser.mockReturnValue({
      user: { id: 'user-1' },
      loading: false,
      error: null,
    })

    mockUseUserSpaces.mockReturnValue({
      spaces: [
        { id: 'space-1', name: 'プロジェクトA', orgId: 'org-123', orgName: 'Test Org', role: 'admin', archivedAt: null, groupId: null, sortOrder: 0 },
        { id: 'space-2', name: 'プロジェクトB', orgId: 'org-123', orgName: 'Test Org', role: 'editor', archivedAt: null, groupId: null, sortOrder: 1 },
      ],
      loading: false,
      error: null,
      refetch: vi.fn(),
    })

    mockRpc.mockImplementation((fnName: string) => {
      if (fnName === 'rpc_get_org_members') {
        return Promise.resolve({
          data: [
            { user_id: 'user-1', display_name: 'Owner User', email: 'owner@example.com', avatar_url: null, role: 'owner', joined_at: '2026-01-01' },
            { user_id: 'user-2', display_name: 'Member User', email: 'member@example.com', avatar_url: null, role: 'member', joined_at: '2026-01-02' },
          ],
          error: null,
        })
      }
      return Promise.resolve({ data: { ok: true }, error: null })
    })
  })

  it('shows a space dropdown populated from the org spaces', async () => {
    render(<MembersSettingsPage />)

    await waitFor(() => expect(screen.getByText('メンバーを招待')).toBeInTheDocument())

    expect(screen.getByRole('option', { name: 'プロジェクトA' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'プロジェクトB' })).toBeInTheDocument()
  })

  it('shows a character counter and an error when the message exceeds 500 characters', async () => {
    render(<MembersSettingsPage />)
    await waitFor(() => expect(screen.getByText('メンバーを招待')).toBeInTheDocument())

    const textarea = screen.getByLabelText(/メッセージ/)
    fireEvent.change(textarea, { target: { value: 'a'.repeat(501) } })

    expect(screen.getByText(/500文字以内/)).toBeInTheDocument()
  })

  it('submits the invite with org_id, space_id, email, role, and message', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ token: 'tok-1', expires_at: '2026-08-01', email_sent: true }),
    })

    render(<MembersSettingsPage />)
    await waitFor(() => expect(screen.getByText('メンバーを招待')).toBeInTheDocument())

    fireEvent.change(screen.getByPlaceholderText('email@example.com'), {
      target: { value: 'invitee@example.com' },
    })
    fireEvent.change(screen.getByLabelText(/プロジェクト/), { target: { value: 'space-2' } })
    fireEvent.change(screen.getByLabelText(/メッセージ/), { target: { value: 'よろしくお願いします' } })

    fireEvent.click(screen.getByRole('button', { name: /招待/ }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/invites', expect.objectContaining({
        method: 'POST',
      }))
    })

    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
      ([url]) => url === '/api/invites'
    )!
    const requestBody = JSON.parse(call[1].body)
    expect(requestBody).toEqual({
      org_id: 'org-123',
      space_id: 'space-2',
      email: 'invitee@example.com',
      role: 'member',
      message: 'よろしくお願いします',
    })

    await waitFor(() => {
      expect(screen.getByText(/invitee@example.com.*招待メールを送信しました/)).toBeInTheDocument()
    })
  })

  it('shows a copyable invite link when email sending fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ token: 'tok-1', expires_at: '2026-08-01', email_sent: false }),
    })

    render(<MembersSettingsPage />)
    await waitFor(() => expect(screen.getByText('メンバーを招待')).toBeInTheDocument())

    fireEvent.change(screen.getByPlaceholderText('email@example.com'), {
      target: { value: 'invitee@example.com' },
    })

    fireEvent.click(screen.getByRole('button', { name: /招待/ }))

    await waitFor(() => {
      expect(screen.getByText(/メール送信に失敗したためリンクを共有してください/)).toBeInTheDocument()
    })
    expect(screen.getByDisplayValue(/\/invite\/tok-1/)).toBeInTheDocument()
  })

  it('shows the API error message when the invite fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Organization has reached member limit. Please upgrade your plan.' }),
    })

    render(<MembersSettingsPage />)
    await waitFor(() => expect(screen.getByText('メンバーを招待')).toBeInTheDocument())

    fireEvent.change(screen.getByPlaceholderText('email@example.com'), {
      target: { value: 'invitee@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: /招待/ }))

    await waitFor(() => {
      expect(screen.getByText('Organization has reached member limit. Please upgrade your plan.')).toBeInTheDocument()
    })
  })
})

describe('MembersSettingsPage pending invites section', () => {
  function pendingInvitesFixture() {
    return [
      {
        id: 'invite-1',
        email: 'pending@example.com',
        role: 'member',
        space_id: 'space-1',
        space_name: 'プロジェクトA',
        created_at: '2026-07-01T00:00:00Z',
        expires_at: '2026-09-29T00:00:00Z',
      },
    ]
  }

  function mockFetchByUrl(handlers: Record<string, () => Promise<unknown>>) {
    return vi.fn((url: string, init?: RequestInit) => {
      void init
      for (const [pattern, handler] of Object.entries(handlers)) {
        if (url.includes(pattern)) return handler()
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()

    mockUseCurrentOrg.mockReturnValue({
      orgId: 'org-123',
      orgName: 'Test Org',
      role: 'owner',
      loading: false,
      error: null,
    })

    mockUseCurrentUser.mockReturnValue({
      user: { id: 'user-1' },
      loading: false,
      error: null,
    })

    mockUseUserSpaces.mockReturnValue({
      spaces: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    })

    mockRpc.mockImplementation((fnName: string) => {
      if (fnName === 'rpc_get_org_members') {
        return Promise.resolve({
          data: [
            { user_id: 'user-1', display_name: 'Owner User', email: 'owner@example.com', avatar_url: null, role: 'owner', joined_at: '2026-01-01' },
          ],
          error: null,
        })
      }
      return Promise.resolve({ data: { ok: true }, error: null })
    })
  })

  it('fetches and renders the pending invites list for the org owner', async () => {
    global.fetch = mockFetchByUrl({
      '/api/invites/pending?org_id=org-123': () =>
        Promise.resolve({ ok: true, json: () => Promise.resolve({ invites: pendingInvitesFixture() }) }),
    }) as unknown as typeof fetch

    render(<MembersSettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('保留中の招待')).toBeInTheDocument()
    })
    expect(screen.getByText('pending@example.com')).toBeInTheDocument()
    expect(screen.getByText('プロジェクトA')).toBeInTheDocument()
  })

  it('hides the pending invites section when there are none', async () => {
    global.fetch = mockFetchByUrl({
      '/api/invites/pending?org_id=org-123': () =>
        Promise.resolve({ ok: true, json: () => Promise.resolve({ invites: [] }) }),
    }) as unknown as typeof fetch

    render(<MembersSettingsPage />)
    await waitFor(() => expect(screen.getByText('メンバーを招待')).toBeInTheDocument())

    expect(screen.queryByText('保留中の招待')).not.toBeInTheDocument()
  })

  it('cancels a pending invite via DELETE and removes it from the list', async () => {
    const deleteMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) }))
    global.fetch = mockFetchByUrl({
      '/api/invites/pending/invite-1': deleteMock,
      '/api/invites/pending?org_id=org-123': () =>
        Promise.resolve({ ok: true, json: () => Promise.resolve({ invites: pendingInvitesFixture() }) }),
    }) as unknown as typeof fetch

    render(<MembersSettingsPage />)
    await waitFor(() => expect(screen.getByText('pending@example.com')).toBeInTheDocument())

    fireEvent.click(screen.getByTitle('招待を取り消す'))

    await waitFor(() => {
      expect(deleteMock).toHaveBeenCalled()
    })
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('招待を取り消しました'))
    expect(screen.queryByText('pending@example.com')).not.toBeInTheDocument()
  })

  it('shows an error toast and keeps the row when cancel fails', async () => {
    global.fetch = mockFetchByUrl({
      '/api/invites/pending/invite-1': () =>
        Promise.resolve({ ok: false, json: () => Promise.resolve({ error: 'failed' }) }),
      '/api/invites/pending?org_id=org-123': () =>
        Promise.resolve({ ok: true, json: () => Promise.resolve({ invites: pendingInvitesFixture() }) }),
    }) as unknown as typeof fetch

    render(<MembersSettingsPage />)
    await waitFor(() => expect(screen.getByText('pending@example.com')).toBeInTheDocument())

    fireEvent.click(screen.getByTitle('招待を取り消す'))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('招待の取り消しに失敗しました'))
    expect(screen.getByText('pending@example.com')).toBeInTheDocument()
  })

  it('resends a pending invite via POST and shows a success toast', async () => {
    const resendMock = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, email_sent: true, expires_at: '2026-10-05T00:00:00Z' }) })
    )
    global.fetch = mockFetchByUrl({
      '/api/invites/pending/invite-1/resend': resendMock,
      '/api/invites/pending?org_id=org-123': () =>
        Promise.resolve({ ok: true, json: () => Promise.resolve({ invites: pendingInvitesFixture() }) }),
    }) as unknown as typeof fetch

    render(<MembersSettingsPage />)
    await waitFor(() => expect(screen.getByText('pending@example.com')).toBeInTheDocument())

    fireEvent.click(screen.getByTitle('招待を再送する'))

    await waitFor(() => {
      expect(resendMock).toHaveBeenCalled()
    })
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('招待を再送しました'))
  })

  it('shows an error toast when resend fails', async () => {
    global.fetch = mockFetchByUrl({
      '/api/invites/pending/invite-1/resend': () =>
        Promise.resolve({ ok: false, json: () => Promise.resolve({ error: 'failed' }) }),
      '/api/invites/pending?org_id=org-123': () =>
        Promise.resolve({ ok: true, json: () => Promise.resolve({ invites: pendingInvitesFixture() }) }),
    }) as unknown as typeof fetch

    render(<MembersSettingsPage />)
    await waitFor(() => expect(screen.getByText('pending@example.com')).toBeInTheDocument())

    fireEvent.click(screen.getByTitle('招待を再送する'))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('招待の再送に失敗しました'))
  })
})

describe('MembersSettingsPage role change / removal (RPC-backed writes)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // pending invites fetch on mount (org owner); benign response keeps this
    // describe block focused on role change/removal without console noise
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ invites: [] }) })

    mockUseCurrentOrg.mockReturnValue({
      orgId: 'org-123',
      orgName: 'Test Org',
      role: 'owner',
      loading: false,
      error: null,
    })

    mockUseCurrentUser.mockReturnValue({
      user: { id: 'user-1' },
      loading: false,
      error: null,
    })

    mockUseUserSpaces.mockReturnValue({
      spaces: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    })
  })

  function mockMembersList() {
    return [
      { user_id: 'user-1', display_name: 'Owner User', email: 'owner@example.com', avatar_url: null, role: 'owner', joined_at: '2026-01-01' },
      { user_id: 'user-2', display_name: 'Member User', email: 'member@example.com', avatar_url: null, role: 'member', joined_at: '2026-01-02' },
    ]
  }

  function getRoleSelectForMember(displayName: string): HTMLElement {
    const row = screen.getByText(displayName).closest('.divide-y > div') as HTMLElement
    return within(row).getByRole('combobox')
  }

  it('calls rpc_update_org_member_role with org_id/user_id/role and shows success only after RPC succeeds', async () => {
    mockRpc.mockImplementation((fnName: string) => {
      if (fnName === 'rpc_get_org_members') {
        return Promise.resolve({ data: mockMembersList(), error: null })
      }
      if (fnName === 'rpc_update_org_member_role') {
        return Promise.resolve({ data: { ok: true }, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    })

    render(<MembersSettingsPage />)
    await waitFor(() => expect(screen.getByText('Member User')).toBeInTheDocument())

    const select = getRoleSelectForMember('Member User')
    fireEvent.change(select, { target: { value: 'client' } })

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('rpc_update_org_member_role', {
        p_org_id: 'org-123',
        p_user_id: 'user-2',
        p_role: 'client',
      })
    })

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('役割を変更しました'))
    expect(toastError).not.toHaveBeenCalled()
  })

  it('demoting a member to client sends p_role=client so the RPC can propagate the demotion to their space roles', async () => {
    // Server-side rpc_update_org_member_role additionally cascades this to
    // space_memberships (admin/editor/viewer -> client) to avoid an org=client
    // x space=internal-role inconsistency. That DB-side propagation isn't
    // exercised by this UI-level test; this only pins the RPC call contract
    // (p_role) that the propagation relies on.
    mockRpc.mockImplementation((fnName: string) => {
      if (fnName === 'rpc_get_org_members') {
        return Promise.resolve({ data: mockMembersList(), error: null })
      }
      if (fnName === 'rpc_update_org_member_role') {
        return Promise.resolve({ data: { ok: true }, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    })

    render(<MembersSettingsPage />)
    await waitFor(() => expect(screen.getByText('Member User')).toBeInTheDocument())

    fireEvent.change(getRoleSelectForMember('Member User'), { target: { value: 'client' } })

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('rpc_update_org_member_role', expect.objectContaining({ p_role: 'client' }))
    })
  })

  it('rolls back the optimistic update and shows an error toast when rpc_update_org_member_role fails (no false success)', async () => {
    mockRpc.mockImplementation((fnName: string) => {
      if (fnName === 'rpc_get_org_members') {
        return Promise.resolve({ data: mockMembersList(), error: null })
      }
      if (fnName === 'rpc_update_org_member_role') {
        return Promise.resolve({ data: null, error: { message: 'Not authorized: only org owners can change member roles' } })
      }
      return Promise.resolve({ data: null, error: null })
    })

    render(<MembersSettingsPage />)
    await waitFor(() => expect(screen.getByText('Member User')).toBeInTheDocument())

    const select = getRoleSelectForMember('Member User')
    fireEvent.change(select, { target: { value: 'client' } })

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('役割の変更に失敗しました'))
    expect(toastSuccess).not.toHaveBeenCalled()
    // Rolled back: role select still shows the original role
    await waitFor(() => expect(getRoleSelectForMember('Member User')).toHaveValue('member'))
  })

  it('shows a dedicated message when the last-owner guard rejects a role change', async () => {
    mockRpc.mockImplementation((fnName: string) => {
      if (fnName === 'rpc_get_org_members') {
        return Promise.resolve({
          data: [
            { user_id: 'user-1', display_name: 'Owner User', email: 'owner@example.com', avatar_url: null, role: 'owner', joined_at: '2026-01-01' },
            { user_id: 'user-2', display_name: 'Second Owner', email: 'owner2@example.com', avatar_url: null, role: 'owner', joined_at: '2026-01-02' },
          ],
          error: null,
        })
      }
      if (fnName === 'rpc_update_org_member_role') {
        return Promise.resolve({ data: null, error: { message: 'Cannot demote the last owner' } })
      }
      return Promise.resolve({ data: null, error: null })
    })

    render(<MembersSettingsPage />)
    await waitFor(() => expect(screen.getByText('Second Owner')).toBeInTheDocument())

    const select = getRoleSelectForMember('Second Owner')
    fireEvent.change(select, { target: { value: 'member' } })

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('最後のオーナーの役割は変更できません'))
  })

  it('calls rpc_remove_org_member with org_id/user_id and removes the row only after RPC succeeds', async () => {
    mockRpc.mockImplementation((fnName: string) => {
      if (fnName === 'rpc_get_org_members') {
        return Promise.resolve({ data: mockMembersList(), error: null })
      }
      if (fnName === 'rpc_remove_org_member') {
        return Promise.resolve({ data: { ok: true }, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    })

    render(<MembersSettingsPage />)
    await waitFor(() => expect(screen.getByText('Member User')).toBeInTheDocument())

    fireEvent.click(screen.getByTitle('メンバーを削除'))

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('rpc_remove_org_member', {
        p_org_id: 'org-123',
        p_user_id: 'user-2',
      })
    })

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('メンバーを削除しました'))
    expect(screen.queryByText('Member User')).not.toBeInTheDocument()
  })

  it('rolls back the optimistic removal and shows an error toast when rpc_remove_org_member fails (no false success)', async () => {
    mockRpc.mockImplementation((fnName: string) => {
      if (fnName === 'rpc_get_org_members') {
        return Promise.resolve({ data: mockMembersList(), error: null })
      }
      if (fnName === 'rpc_remove_org_member') {
        return Promise.resolve({ data: null, error: { message: 'Not authorized: only org owners can remove members' } })
      }
      return Promise.resolve({ data: null, error: null })
    })

    render(<MembersSettingsPage />)
    await waitFor(() => expect(screen.getByText('Member User')).toBeInTheDocument())

    fireEvent.click(screen.getByTitle('メンバーを削除'))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('メンバーの削除に失敗しました'))
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(screen.getByText('Member User')).toBeInTheDocument()
  })

  it('shows a dedicated message when the last-owner guard rejects a removal', async () => {
    mockRpc.mockImplementation((fnName: string) => {
      if (fnName === 'rpc_get_org_members') {
        return Promise.resolve({
          data: [
            { user_id: 'user-1', display_name: 'Owner User', email: 'owner@example.com', avatar_url: null, role: 'owner', joined_at: '2026-01-01' },
            { user_id: 'user-2', display_name: 'Second Owner', email: 'owner2@example.com', avatar_url: null, role: 'owner', joined_at: '2026-01-02' },
          ],
          error: null,
        })
      }
      if (fnName === 'rpc_remove_org_member') {
        return Promise.resolve({ data: null, error: { message: 'Cannot remove the last owner' } })
      }
      return Promise.resolve({ data: null, error: null })
    })

    render(<MembersSettingsPage />)
    await waitFor(() => expect(screen.getByText('Second Owner')).toBeInTheDocument())

    fireEvent.click(screen.getByTitle('メンバーを削除'))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('最後のオーナーは削除できません'))
    expect(screen.getByText('Second Owner')).toBeInTheDocument()
  })
})
