import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react'
import { MembersSettings } from '@/app/(internal)/[orgId]/project/[spaceId]/settings/MembersSettings'

const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}))

const mockConfirm = vi.fn().mockResolvedValue(true)
vi.mock('@/components/shared', () => ({
  useConfirmDialog: () => ({ confirm: (...args: unknown[]) => mockConfirm(...args), ConfirmDialog: null }),
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

function membersFixture() {
  return [
    { user_id: 'user-1', display_name: 'Admin User', avatar_url: null, role: 'admin' },
    { user_id: 'user-2', display_name: 'Editor User', avatar_url: null, role: 'editor' },
  ]
}

function getRoleSelectFor(displayName: string): HTMLElement {
  const row = screen.getByText(displayName).closest('.divide-y > div') as HTMLElement
  return within(row).getByRole('combobox')
}

describe('MembersSettings role change / removal (RPC-backed writes)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConfirm.mockResolvedValue(true)

    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })

    mockFrom.mockReturnValue({
      select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
    })

    mockRpc.mockImplementation((fnName: string) => {
      if (fnName === 'rpc_get_space_members') {
        return Promise.resolve({ data: membersFixture(), error: null })
      }
      return Promise.resolve({ data: { ok: true }, error: null })
    })
  })

  it('calls rpc_update_space_member_role with space_id/user_id/role and shows success only after RPC succeeds', async () => {
    mockRpc.mockImplementation((fnName: string) => {
      if (fnName === 'rpc_get_space_members') {
        return Promise.resolve({ data: membersFixture(), error: null })
      }
      if (fnName === 'rpc_update_space_member_role') {
        return Promise.resolve({ data: { ok: true }, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    })

    render(<MembersSettings orgId="org-1" spaceId="space-1" />)
    await waitFor(() => expect(screen.getByText('Editor User')).toBeInTheDocument())

    const select = getRoleSelectFor('Editor User')
    fireEvent.change(select, { target: { value: 'viewer' } })

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('rpc_update_space_member_role', {
        p_space_id: 'space-1',
        p_user_id: 'user-2',
        p_role: 'viewer',
      })
    })

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('役割を変更しました'))
    expect(toastError).not.toHaveBeenCalled()
  })

  it('rolls back the optimistic update and shows an error toast when rpc_update_space_member_role fails (no false success)', async () => {
    mockRpc.mockImplementation((fnName: string) => {
      if (fnName === 'rpc_get_space_members') {
        return Promise.resolve({ data: membersFixture(), error: null })
      }
      if (fnName === 'rpc_update_space_member_role') {
        return Promise.resolve({ data: null, error: { message: 'Not authorized: only org owners or space admins can change member roles' } })
      }
      return Promise.resolve({ data: null, error: null })
    })

    render(<MembersSettings orgId="org-1" spaceId="space-1" />)
    await waitFor(() => expect(screen.getByText('Editor User')).toBeInTheDocument())

    const select = getRoleSelectFor('Editor User')
    fireEvent.change(select, { target: { value: 'viewer' } })

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('役割の変更に失敗しました'))
    expect(toastSuccess).not.toHaveBeenCalled()
    await waitFor(() => expect(getRoleSelectFor('Editor User')).toHaveValue('editor'))
  })

  it('calls rpc_remove_space_member with space_id/user_id and removes the row only after RPC succeeds', async () => {
    mockRpc.mockImplementation((fnName: string) => {
      if (fnName === 'rpc_get_space_members') {
        return Promise.resolve({ data: membersFixture(), error: null })
      }
      if (fnName === 'rpc_remove_space_member') {
        return Promise.resolve({ data: { ok: true }, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    })

    render(<MembersSettings orgId="org-1" spaceId="space-1" />)
    await waitFor(() => expect(screen.getByText('Editor User')).toBeInTheDocument())

    fireEvent.click(screen.getByTitle('メンバーを削除'))

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('rpc_remove_space_member', {
        p_space_id: 'space-1',
        p_user_id: 'user-2',
      })
    })

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('メンバーを削除しました'))
    expect(screen.queryByText('Editor User')).not.toBeInTheDocument()
  })

  it('rolls back the optimistic removal and shows an error toast when rpc_remove_space_member fails (no false success)', async () => {
    mockRpc.mockImplementation((fnName: string) => {
      if (fnName === 'rpc_get_space_members') {
        return Promise.resolve({ data: membersFixture(), error: null })
      }
      if (fnName === 'rpc_remove_space_member') {
        return Promise.resolve({ data: null, error: { message: 'Not authorized: only org owners or space admins can remove members' } })
      }
      return Promise.resolve({ data: null, error: null })
    })

    render(<MembersSettings orgId="org-1" spaceId="space-1" />)
    await waitFor(() => expect(screen.getByText('Editor User')).toBeInTheDocument())

    fireEvent.click(screen.getByTitle('メンバーを削除'))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('メンバーの削除に失敗しました'))
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(screen.getByText('Editor User')).toBeInTheDocument()
  })
})
