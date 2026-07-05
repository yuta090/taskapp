import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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
    from: () => ({
      update: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
      delete: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
    }),
  }),
}))

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

    mockRpc.mockResolvedValue({
      data: [
        { user_id: 'user-1', display_name: 'Owner User', email: 'owner@example.com', avatar_url: null, role: 'owner', joined_at: '2026-01-01' },
      ],
      error: null,
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

    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
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
