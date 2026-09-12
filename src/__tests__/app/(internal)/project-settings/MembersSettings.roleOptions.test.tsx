import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react'
import { MembersSettings } from '@/app/(internal)/[orgId]/project/[spaceId]/settings/MembersSettings'

/**
 * RC-2: 組織の役割と space の役割をそろえる（役割の選択肢を絞り込む）。
 * 決まり（Fable裁定 role-consistency-decision）:
 * - 組織が社内（owner/member）→ 管理者/編集者/閲覧者 だけ選べる
 * - 組織が client → クライアント だけ。代理店モードのときだけ ベンダー も選べる
 * - 組織の役割が分かるまで・分からなければ、役割は変えられないように倒す（安全側）
 *
 * ここでは allowedSpaceRolesFor 自体（spaceRoles.test.ts）ではなく、
 * MembersSettings がそれを正しく呼び出して選択肢を絞っているかだけを見る。
 */

const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}))

vi.mock('@/components/shared', async () => {
  const { Hint } = await import('@/components/shared/Hint')
  return {
    Hint,
    useConfirmDialog: () => ({ confirm: vi.fn().mockResolvedValue(true), ConfirmDialog: null }),
  }
})

vi.mock('@/lib/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { id: 'admin-1' }, loading: false, error: null }),
}))

vi.mock('@/lib/hooks/useSpaceMemberJoinedAt', () => ({
  useSpaceMemberJoinedAt: () => null,
}))

vi.mock('@/lib/hooks/useInviteTemplate', () => ({
  useInviteTemplate: () => ({ template: null, loading: false, error: null, refresh: vi.fn() }),
}))

vi.mock('@/lib/hooks/useSpaceInvites', () => ({
  useSpaceInvites: () => ({ invites: [], canManage: true, loading: false, error: null, refresh: vi.fn() }),
}))

let sharedMembers = [
  { id: 'admin-1', displayName: '管理者', avatarUrl: null, role: 'admin' },
  { id: 'target-1', displayName: '対象さん', avatarUrl: null, role: 'editor' },
]
vi.mock('@/lib/hooks/useSpaceMembers', () => ({
  useSpaceMembers: () => ({
    members: sharedMembers,
    loading: false,
    isPending: false,
    error: null,
    refetch: vi.fn(),
    patchMembers: vi.fn(() => () => {}),
  }),
}))

let mockAgencyMode = false
vi.mock('@/lib/hooks/useSpaceRow', () => ({
  useSpaceRow: () => ({ space: { agency_mode: mockAgencyMode }, isPending: false }),
}))

let mockOrgRoleByUserId = new Map<string, string>()
let mockOrgMembersPending = false
let mockOrgMembersLoadingError = false
const useOrgMembersMock = vi.fn<
  (orgId: string | null, options?: { enabled?: boolean }) => {
    members: unknown[]
    roleByUserId: Map<string, string>
    isPending: boolean
    isLoadingError: boolean
    error: null
  }
>(() => ({
  members: [],
  roleByUserId: mockOrgRoleByUserId,
  isPending: mockOrgMembersPending,
  isLoadingError: mockOrgMembersLoadingError,
  error: null,
}))
vi.mock('@/lib/hooks/useOrgMembers', () => ({
  useOrgMembers: (...args: [string | null, { enabled?: boolean }?]) => useOrgMembersMock(...args),
}))

// 左メニュー等が既に持っている「自分の所属space一覧」。sharedMembers（一覧）の到着を
// 待たずに「自分がこのspaceの管理者か」を先に知るための、もう一つの出どころ
let mockUserSpaces: Array<{ id: string; role: string }> = []
vi.mock('@/lib/hooks/useUserSpaces', () => ({
  useUserSpaces: () => ({ spaces: mockUserSpaces, isPending: false, isLoadingError: false }),
}))

const mockRpc = vi.fn()
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    rpc: (...args: unknown[]) => mockRpc(...args),
  }),
}))

function getRoleControlFor(displayName: string): HTMLElement {
  const row = screen.getByText(displayName).closest('.divide-y > div') as HTMLElement
  return row
}

function renderMembers() {
  return render(<MembersSettings orgId="org-1" spaceId="space-1" />)
}

beforeEach(() => {
  vi.clearAllMocks()
  sharedMembers = [
    { id: 'admin-1', displayName: '管理者', avatarUrl: null, role: 'admin' },
    { id: 'target-1', displayName: '対象さん', avatarUrl: null, role: 'editor' },
  ]
  mockAgencyMode = false
  mockOrgRoleByUserId = new Map([
    ['admin-1', 'owner'],
    ['target-1', 'member'],
  ])
  mockOrgMembersPending = false
  mockOrgMembersLoadingError = false
  mockUserSpaces = []
  mockRpc.mockResolvedValue({ data: { ok: true }, error: null })
})

describe('MembersSettings — 役割の選択肢を組織の役割で絞る', () => {
  it('組織が社内（member）の人には 管理者/編集者/閲覧者 だけを出す', async () => {
    renderMembers()
    await waitFor(() => expect(screen.getByText('対象さん')).toBeInTheDocument())

    const select = within(getRoleControlFor('対象さん')).getByRole('combobox')
    const labels = within(select).getAllByRole('option').map((o) => o.textContent)
    expect(labels).toEqual(['管理者', '編集者', '閲覧者'])
  })

  it('組織が client（代理店モードでない）の人には クライアント だけを出す', async () => {
    sharedMembers = [
      { id: 'admin-1', displayName: '管理者', avatarUrl: null, role: 'admin' },
      { id: 'target-1', displayName: '相手先さん', avatarUrl: null, role: 'client' },
    ]
    mockOrgRoleByUserId = new Map([
      ['admin-1', 'owner'],
      ['target-1', 'client'],
    ])
    renderMembers()
    await waitFor(() => expect(screen.getByText('相手先さん')).toBeInTheDocument())

    const select = within(getRoleControlFor('相手先さん')).getByRole('combobox')
    const labels = within(select).getAllByRole('option').map((o) => o.textContent)
    expect(labels).toEqual(['クライアント'])
  })

  it('組織が client かつ代理店モードなら クライアント と ベンダー を出す', async () => {
    mockAgencyMode = true
    sharedMembers = [
      { id: 'admin-1', displayName: '管理者', avatarUrl: null, role: 'admin' },
      { id: 'target-1', displayName: 'ベンダーさん', avatarUrl: null, role: 'vendor' },
    ]
    mockOrgRoleByUserId = new Map([
      ['admin-1', 'owner'],
      ['target-1', 'client'],
    ])
    renderMembers()
    await waitFor(() => expect(screen.getByText('ベンダーさん')).toBeInTheDocument())

    const select = within(getRoleControlFor('ベンダーさん')).getByRole('combobox')
    const labels = within(select).getAllByRole('option').map((o) => o.textContent)
    expect(labels).toEqual(['クライアント', 'ベンダー'])
  })

  it('今の役割が選べる範囲の外でも、選択肢に含めて出す（代理店モードを切ったあとのベンダー等）', async () => {
    // 代理店モードを切ったので、この人（組織はclient）は本来クライアントしか選べないが、
    // まだ空間の役割は vendor のまま残っている（過去に代理店モードだった名残）
    mockAgencyMode = false
    sharedMembers = [
      { id: 'admin-1', displayName: '管理者', avatarUrl: null, role: 'admin' },
      { id: 'target-1', displayName: '元ベンダーさん', avatarUrl: null, role: 'vendor' },
    ]
    mockOrgRoleByUserId = new Map([
      ['admin-1', 'owner'],
      ['target-1', 'client'],
    ])
    renderMembers()
    await waitFor(() => expect(screen.getByText('元ベンダーさん')).toBeInTheDocument())

    const select = within(getRoleControlFor('元ベンダーさん')).getByRole('combobox') as HTMLSelectElement
    const labels = within(select).getAllByRole('option').map((o) => o.textContent)
    // 選べる(クライアント)・今の役割(ベンダー)の両方が出ており、今の役割が選ばれたままになる
    expect(labels).toEqual(expect.arrayContaining(['クライアント', 'ベンダー']))
    expect(select.value).toBe('vendor')
  })

  it('組織の役割がまだ取れていない間は、選択肢を出さず今の役割の表示のまま（安全側）', async () => {
    mockOrgMembersPending = true
    mockOrgRoleByUserId = new Map()
    renderMembers()
    await waitFor(() => expect(screen.getByText('対象さん')).toBeInTheDocument())

    const row = getRoleControlFor('対象さん')
    expect(within(row).queryByRole('combobox')).not.toBeInTheDocument()
    expect(within(row).getByText('編集者')).toBeInTheDocument()
  })

  it('組織の役割の取得に失敗したときも、選択肢を出さず今の役割の表示のまま（安全側）', async () => {
    mockOrgMembersLoadingError = true
    mockOrgRoleByUserId = new Map()
    renderMembers()
    await waitFor(() => expect(screen.getByText('対象さん')).toBeInTheDocument())

    const row = getRoleControlFor('対象さん')
    expect(within(row).queryByRole('combobox')).not.toBeInTheDocument()
    expect(within(row).getByText('編集者')).toBeInTheDocument()
  })

  it('許可されていない役割へ変更しようとしても、RPCを呼ばず分かる日本語の文を出す（防御的な二重チェック）', async () => {
    renderMembers()
    await waitFor(() => expect(screen.getByText('対象さん')).toBeInTheDocument())

    const select = within(getRoleControlFor('対象さん')).getByRole('combobox') as HTMLSelectElement
    // 対象さんは組織が社内(member)なので、選択肢に 'client' は無い。
    // ブラウザは無い値への変更を拒むため、DOM に直接 option を足して値の変更自体は通す
    // （古い選択肢が残っていた・DOMを直接いじられた等の想定）。
    // ここでは「選択肢を絞る」だけでなく、ハンドラー側の防御チェックが効くかを確かめる
    const forcedOption = document.createElement('option')
    forcedOption.value = 'client'
    select.appendChild(forcedOption)
    fireEvent.change(select, { target: { value: 'client' } })

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('この人の組織の役割ではこの役割は選べません')
    )
    expect(mockRpc).not.toHaveBeenCalledWith('rpc_update_space_member_role', expect.anything())
  })

  it('space のメンバー一覧がまだ届いていなくても、useUserSpaces の自分の行から管理者と分かれば組織メンバーの取得を並行して始める', async () => {
    // 一覧(useSpaceMembers)側はまだ空 = このデータだけでは自分が管理者か分からない状態
    sharedMembers = []
    // 左メニュー等が既に持っている自分の所属space一覧には、このspaceで管理者だと出ている
    mockUserSpaces = [{ id: 'space-1', role: 'admin' }]

    renderMembers()

    await waitFor(() => expect(useOrgMembersMock).toHaveBeenCalled())
    const lastCallOptions = useOrgMembersMock.mock.calls.at(-1)?.[1] as { enabled?: boolean } | undefined
    expect(lastCallOptions?.enabled).toBe(true)
  })
})
