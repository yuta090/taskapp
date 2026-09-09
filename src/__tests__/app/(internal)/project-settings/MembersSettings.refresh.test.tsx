import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react'
import { MembersSettings } from '@/app/(internal)/[orgId]/project/[spaceId]/settings/MembersSettings'

/**
 * 参加者一覧の正本は共有キャッシュ（['spaceMembers', spaceId]）ひとつ。
 * 以前はこの画面だけ同じ RPC をもう一度自前で叩いていて、
 * (a) 同じ内容を二重に取りに行く (b) 役割を変えても画面の外が古いまま、の2つが起きていた。
 */

const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}))

const mockConfirm = vi.fn().mockResolvedValue(true)
vi.mock('@/components/shared', async () => {
  const { Hint } = await import('@/components/shared/Hint')
  return {
    Hint,
    useConfirmDialog: () => ({ confirm: (...args: unknown[]) => mockConfirm(...args), ConfirmDialog: null }),
  }
})

vi.mock('@/lib/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { id: 'user-1' }, loading: false, error: null }),
}))

vi.mock('@/lib/hooks/useInviteTemplate', () => ({
  useInviteTemplate: () => ({ template: null, loading: false, error: null, refresh: vi.fn() }),
}))

vi.mock('@/lib/hooks/useSpaceInvites', () => ({
  useSpaceInvites: () => ({ invites: [], canManage: true, loading: false, error: null, refresh: vi.fn() }),
}))

vi.mock('@/lib/hooks/useSpaceMemberJoinedAt', () => ({
  useSpaceMemberJoinedAt: () => ({ 'user-2': '2026-01-01T00:00:00Z' }),
}))

const refetchMembers = vi.fn()
const rollback = vi.fn()
const patchMembers = vi.fn(() => rollback)
let sharedMembers = [
  { id: 'user-1', displayName: 'Admin User', avatarUrl: null, role: 'admin' },
  { id: 'user-2', displayName: 'Editor User', avatarUrl: null, role: 'editor' },
]
let sharedMembersError: string | null = null
vi.mock('@/lib/hooks/useSpaceMembers', () => ({
  useSpaceMembers: () => ({
    members: sharedMembers,
    loading: false,
    isPending: false,
    error: sharedMembersError,
    refetch: refetchMembers,
    patchMembers,
  }),
}))

const mockRpc = vi.fn()
const mockFrom = vi.fn()
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}))

function getRoleSelectFor(displayName: string): HTMLElement {
  const row = screen.getByText(displayName).closest('.divide-y > div') as HTMLElement
  return within(row).getByRole('combobox')
}

beforeEach(() => {
  vi.clearAllMocks()
  sharedMembers = [
    { id: 'user-1', displayName: 'Admin User', avatarUrl: null, role: 'admin' },
    { id: 'user-2', displayName: 'Editor User', avatarUrl: null, role: 'editor' },
  ]
  sharedMembersError = null
  refetchMembers.mockResolvedValue(undefined)
  patchMembers.mockReturnValue(rollback)
  mockConfirm.mockResolvedValue(true)
  mockFrom.mockReturnValue({
    select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
  })
  mockRpc.mockResolvedValue({ data: { ok: true }, error: null })
})

describe('MembersSettings — 参加者一覧の取得は1本にまとめる', () => {
  it('一覧のためのRPCをこの画面から二重に呼ばない', async () => {
    render(<MembersSettings orgId="org-1" spaceId="space-1" />)
    await waitFor(() => expect(screen.getByText('Editor User')).toBeInTheDocument())

    expect(mockRpc).not.toHaveBeenCalledWith('rpc_get_space_members', expect.anything())
  })

  it('役割の変更は共有キャッシュを先に書き換え、成功したら取り直す', async () => {
    render(<MembersSettings orgId="org-1" spaceId="space-1" />)
    await waitFor(() => expect(screen.getByText('Editor User')).toBeInTheDocument())

    fireEvent.change(getRoleSelectFor('Editor User'), { target: { value: 'viewer' } })

    expect(patchMembers).toHaveBeenCalled()
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('役割を変更しました'))
    expect(refetchMembers).toHaveBeenCalled()
    expect(rollback).not.toHaveBeenCalled()
  })

  it('役割の変更が失敗したら元に戻し、取り直さない', async () => {
    mockRpc.mockImplementation((fnName: string) =>
      fnName === 'rpc_update_space_member_role'
        ? Promise.resolve({ data: null, error: { message: 'Not authorized' } })
        : Promise.resolve({ data: { ok: true }, error: null })
    )

    render(<MembersSettings orgId="org-1" spaceId="space-1" />)
    await waitFor(() => expect(screen.getByText('Editor User')).toBeInTheDocument())

    fireEvent.change(getRoleSelectFor('Editor User'), { target: { value: 'viewer' } })

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('役割の変更に失敗しました'))
    expect(rollback).toHaveBeenCalled()
    expect(refetchMembers).not.toHaveBeenCalled()
  })

  it('メンバーを外したら共有キャッシュを取り直す', async () => {
    render(<MembersSettings orgId="org-1" spaceId="space-1" />)
    await waitFor(() => expect(screen.getByText('Editor User')).toBeInTheDocument())

    fireEvent.click(screen.getByTitle('メンバーを削除'))

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('メンバーを削除しました'))
    expect(patchMembers).toHaveBeenCalled()
    expect(refetchMembers).toHaveBeenCalled()
  })

  it('一覧が出ているうちは、取り直しが失敗してもエラー画面に差し替えない', async () => {
    // 2分あけてタブに戻ると背景で取り直しが走る。そこが一瞬こけただけで、
    // 使える一覧があるのに画面全体（招待フォームごと）が消えてはいけない
    sharedMembersError = 'メンバー情報の取得に失敗しました'

    render(<MembersSettings orgId="org-1" spaceId="space-1" />)

    await waitFor(() => expect(screen.getByText('Editor User')).toBeInTheDocument())
    expect(screen.queryByText('メンバー情報の取得に失敗しました')).not.toBeInTheDocument()
    expect(screen.getByText('メンバーを招待')).toBeInTheDocument()
  })

  it('一覧が一度も取れていないときはエラーを出す', async () => {
    sharedMembers = []
    sharedMembersError = 'メンバー情報の取得に失敗しました'

    render(<MembersSettings orgId="org-1" spaceId="space-1" />)

    await waitFor(() =>
      expect(screen.getByText('メンバー情報の取得に失敗しました')).toBeInTheDocument()
    )
  })

  it('招待が通ったあとも参加者一覧を取り直す（すでに登録済みの相手はその場で参加者になる）', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ token: 'tok-1', expires_at: '2026-10-01', email_sent: true }),
    }) as unknown as typeof fetch

    render(<MembersSettings orgId="org-1" spaceId="space-1" />)
    await waitFor(() => expect(screen.getByText('メンバーを招待')).toBeInTheDocument())

    fireEvent.change(screen.getByPlaceholderText('email@example.com'), {
      target: { value: 'invitee@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: '招待' }))

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled())
    expect(refetchMembers).toHaveBeenCalled()
  })
})
