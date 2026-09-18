import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import { MembersSettings } from '@/app/(internal)/[orgId]/project/[spaceId]/settings/MembersSettings'

/**
 * メンバー一覧に、名前とメールアドレスを並べて出す。
 *
 * 招待した人の表示名は、本人が名乗らないとメールの @ より前（例 taro）だけになるため、
 * 名前だけでは誰か分からない。メールは組織メンバー一覧（rpc_get_org_members）が返すもので、
 * DB 側が「組織のオーナー / 管理者にだけ返す」と決めている（member-directory の裁定）。
 * 画面は、返ってきたときだけ出す・無ければ何も出さない。
 */

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/components/shared', async () => {
  const { Hint } = await import('@/components/shared/Hint')
  return {
    Hint,
    useConfirmDialog: () => ({ confirm: vi.fn().mockResolvedValue(true), ConfirmDialog: null }),
  }
})

vi.mock('@/lib/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { id: 'me-1' }, loading: false, error: null }),
}))

let mockJoinedAt: Record<string, string> | null = null
vi.mock('@/lib/hooks/useSpaceMemberJoinedAt', () => ({
  useSpaceMemberJoinedAt: () => mockJoinedAt,
}))

vi.mock('@/lib/hooks/useInviteTemplate', () => ({
  useInviteTemplate: () => ({ template: null, loading: false, error: null, refresh: vi.fn() }),
}))

vi.mock('@/lib/hooks/useSpaceInvites', () => ({
  useSpaceInvites: () => ({ invites: [], canManage: true, loading: false, error: null, refresh: vi.fn() }),
}))

let sharedMembers = [
  { id: 'me-1', displayName: '管理者', avatarUrl: null, role: 'admin' },
  { id: 'target-1', displayName: 'taro', avatarUrl: null, role: 'editor' },
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

vi.mock('@/lib/hooks/useSpaceRow', () => ({
  useSpaceRow: () => ({ space: { agency_mode: false }, isPending: false }),
}))

let mockEmailByUserId = new Map<string, string>()
const useOrgMembersMock = vi.fn(() => ({
  members: [],
  roleByUserId: new Map([
    ['me-1', 'owner'],
    ['target-1', 'member'],
  ]),
  emailByUserId: mockEmailByUserId,
  isPending: false,
  isLoadingError: false,
  error: null,
}))
vi.mock('@/lib/hooks/useOrgMembers', () => ({
  useOrgMembers: () => useOrgMembersMock(),
}))

vi.mock('@/lib/hooks/useUserSpaces', () => ({
  useUserSpaces: () => ({ spaces: [], isPending: false, isLoadingError: false }),
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ rpc: vi.fn().mockResolvedValue({ data: null, error: null }) }),
}))

function rowOf(displayName: string): HTMLElement {
  return screen.getByText(displayName).closest('.divide-y > div') as HTMLElement
}

beforeEach(() => {
  vi.clearAllMocks()
  mockJoinedAt = null
  sharedMembers = [
    { id: 'me-1', displayName: '管理者', avatarUrl: null, role: 'admin' },
    { id: 'target-1', displayName: 'taro', avatarUrl: null, role: 'editor' },
  ]
  mockEmailByUserId = new Map([
    ['me-1', 'owner@example.com'],
    ['target-1', 'taro@example.com'],
  ])
})

describe('MembersSettings — メンバー一覧の名前とメールアドレス', () => {
  it('名前の下にメールアドレスを出す', async () => {
    render(<MembersSettings orgId="org-1" spaceId="space-1" />)
    await waitFor(() => expect(screen.getByText('taro')).toBeInTheDocument())

    expect(within(rowOf('taro')).getByText('taro@example.com')).toBeInTheDocument()
    // 自分の行にも出る（「管理者」は役割の説明にも出てくる語なので、行ではなく画面で見る）
    expect(screen.getByText('owner@example.com')).toBeInTheDocument()
  })

  it('参加日と一緒に出す（どちらも読める）', async () => {
    mockJoinedAt = { 'target-1': '2026-09-01T00:00:00Z' }
    render(<MembersSettings orgId="org-1" spaceId="space-1" />)
    await waitFor(() => expect(screen.getByText('taro')).toBeInTheDocument())

    const row = rowOf('taro')
    expect(within(row).getByText('taro@example.com')).toBeInTheDocument()
    expect(within(row).getByText(/参加: 2026\/9\/1/)).toBeInTheDocument()
  })

  it('メールが分からない人には出さない（参加日だけが残る）', async () => {
    mockEmailByUserId = new Map()
    mockJoinedAt = { 'target-1': '2026-09-01T00:00:00Z' }
    render(<MembersSettings orgId="org-1" spaceId="space-1" />)
    await waitFor(() => expect(screen.getByText('taro')).toBeInTheDocument())

    const row = rowOf('taro')
    expect(within(row).queryByText(/@/)).not.toBeInTheDocument()
    expect(within(row).getByText('参加: 2026/9/1')).toBeInTheDocument()
  })

})
