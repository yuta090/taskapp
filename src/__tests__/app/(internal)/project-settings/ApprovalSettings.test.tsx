import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ApprovalSettings } from '@/app/(internal)/[orgId]/project/[spaceId]/settings/ApprovalSettings'

let members = [
  { id: 'u1', displayName: '自分', avatarUrl: null, role: 'admin' },
  { id: 'i1', displayName: '田中', avatarUrl: null, role: 'editor' },
  { id: 'c1', displayName: '相手先の人', avatarUrl: null, role: 'client' },
]

let membersPending = false

// internalMembers は useSpaceMembers 本体と同じ規則（admin/editor/viewer）で渡す。
// ApprovalSettings 側は、そこからさらに承認者になれる役割（admin/editor）に絞る
vi.mock('@/lib/hooks/useSpaceMembers', () => ({
  useSpaceMembers: () => ({
    members,
    internalMembers: members.filter((m) => m.role === 'admin' || m.role === 'editor' || m.role === 'viewer'),
    clientMembers: members.filter((m) => m.role === 'client'),
    loading: false,
    isPending: membersPending,
  }),
}))

let defaultReviewerIds: string[] = []
const setDefaultReviewer = vi.fn()

vi.mock('@/lib/hooks/useDefaultReviewers', () => ({
  useDefaultReviewers: () => ({
    defaultReviewerIds,
    loading: false,
    saving: false,
    setDefaultReviewer,
  }),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

// 既定は「編集できる」(admin/editor)。閲覧者(viewer)・未確定の挙動は下の describe で
// canEdit:false を明示して検証する。
let mockCanEdit = true
vi.mock('@/lib/hooks/useCanEditSpace', () => ({
  useCanEditSpace: () => ({ canEdit: mockCanEdit, canEditMoney: false, resolved: true, loading: false }),
}))

beforeEach(() => {
  setDefaultReviewer.mockReset().mockResolvedValue(undefined)
  defaultReviewerIds = []
  membersPending = false
  mockCanEdit = true
  members = [
    { id: 'u1', displayName: '自分', avatarUrl: null, role: 'admin' },
    { id: 'i1', displayName: '田中', avatarUrl: null, role: 'editor' },
    { id: 'c1', displayName: '相手先の人', avatarUrl: null, role: 'client' },
  ]
})

describe('ApprovalSettings — 既定の承認者', () => {
  it('社内メンバーだけが並ぶ（相手先は承認者にできない）', () => {
    render(<ApprovalSettings orgId="o1" spaceId="s1" />)

    expect(screen.getByText('自分')).toBeInTheDocument()
    expect(screen.getByText('田中')).toBeInTheDocument()
    expect(screen.queryByText('相手先の人')).not.toBeInTheDocument()
  })

  it('既定になっている人はオンで表示される', () => {
    defaultReviewerIds = ['i1']
    render(<ApprovalSettings orgId="o1" spaceId="s1" />)

    expect(screen.getByRole('switch', { name: '田中' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('switch', { name: '自分' })).toHaveAttribute('aria-checked', 'false')
  })

  it('オンにすると既定の承認者に加わる', async () => {
    render(<ApprovalSettings orgId="o1" spaceId="s1" />)

    fireEvent.click(screen.getByRole('switch', { name: '田中' }))

    await waitFor(() => expect(setDefaultReviewer).toHaveBeenCalledWith('i1', true))
  })

  it('オフにすると既定から外れる', async () => {
    defaultReviewerIds = ['i1']
    render(<ApprovalSettings orgId="o1" spaceId="s1" />)

    fireEvent.click(screen.getByRole('switch', { name: '田中' }))

    await waitFor(() => expect(setDefaultReviewer).toHaveBeenCalledWith('i1', false))
  })

  it('メンバーを読み込んでいる間は「いません」を出さない（先に既定が返っても点滅させない）', () => {
    membersPending = true
    members = []
    render(<ApprovalSettings orgId="o1" spaceId="s1" />)

    expect(screen.queryByText('社内メンバーがいません')).not.toBeInTheDocument()
  })

  it('社内メンバーがいなければその旨を出す', () => {
    members = [{ id: 'c1', displayName: '相手先の人', avatarUrl: null, role: 'client' }]
    render(<ApprovalSettings orgId="o1" spaceId="s1" />)

    expect(screen.getByText('社内メンバーがいません')).toBeInTheDocument()
  })

  it('閲覧者(viewer)は承認者候補に並ばない（rpc_review_openがadmin/editorしか受け付けないため）', () => {
    members = [
      { id: 'u1', displayName: '自分', avatarUrl: null, role: 'admin' },
      { id: 'v1', displayName: '鈴木（閲覧者）', avatarUrl: null, role: 'viewer' },
    ]
    render(<ApprovalSettings orgId="o1" spaceId="s1" />)

    expect(screen.getByText('自分')).toBeInTheDocument()
    expect(screen.queryByText('鈴木（閲覧者）')).not.toBeInTheDocument()
  })
})

// 既定の承認者(spaces.default_reviewer_ids)の更新は spaces の更新（RLS: app_can_write_space）
// と同じ規則。閲覧者・役割が未確定の間は切り替えられないようにする。
describe('ApprovalSettings — 閲覧者・役割未確定には操作させない', () => {
  it('トグルが disabled になる', () => {
    mockCanEdit = false
    render(<ApprovalSettings orgId="o1" spaceId="s1" />)

    expect(screen.getByRole('switch', { name: '自分' })).toBeDisabled()
    expect(screen.getByRole('switch', { name: '田中' })).toBeDisabled()
  })

  it('押しても保存しない', () => {
    mockCanEdit = false
    render(<ApprovalSettings orgId="o1" spaceId="s1" />)

    fireEvent.click(screen.getByRole('switch', { name: '田中' }))

    expect(setDefaultReviewer).not.toHaveBeenCalled()
  })
})

// 既定の承認者(spaces.default_reviewer_ids)に、その後 viewer に下げられた・
// スペースを抜けた等で候補外になった人のIDが残ることがある(TaskReviewSection側では
// resolveDefaultReviewerIdsで無視しているだけで、DBの値自体は残ったまま)。
// 見えない・外せないままだと気づけないので、外すよう促す
describe('ApprovalSettings — 候補外になった既定の承認者', () => {
  it('候補外のIDが既定に残っていると、外すよう促すバナーが出る', () => {
    members = [
      { id: 'u1', displayName: '自分', avatarUrl: null, role: 'admin' },
      { id: 'i1', displayName: '田中', avatarUrl: null, role: 'editor' },
      // v1 は前は承認者候補(editor)だったが、いまは viewer に下げられている
      { id: 'v1', displayName: '鈴木（閲覧者）', avatarUrl: null, role: 'viewer' },
    ]
    defaultReviewerIds = ['i1', 'v1']
    render(<ApprovalSettings orgId="o1" spaceId="s1" />)

    expect(screen.getByText(/候補外の人/)).toBeInTheDocument()
    expect(screen.getByText(/鈴木（閲覧者）/)).toBeInTheDocument()
  })

  it('候補外のIDが無ければバナーは出ない', () => {
    defaultReviewerIds = ['i1']
    render(<ApprovalSettings orgId="o1" spaceId="s1" />)

    expect(screen.queryByText(/候補外の人/)).not.toBeInTheDocument()
  })

  it('「外す」を押すと、候補外のIDそれぞれについて既定から外す', async () => {
    members = [
      { id: 'u1', displayName: '自分', avatarUrl: null, role: 'admin' },
      { id: 'v1', displayName: '鈴木（閲覧者）', avatarUrl: null, role: 'viewer' },
    ]
    defaultReviewerIds = ['v1']
    render(<ApprovalSettings orgId="o1" spaceId="s1" />)

    fireEvent.click(screen.getByRole('button', { name: '外す' }))

    await waitFor(() => expect(setDefaultReviewer).toHaveBeenCalledWith('v1', false))
  })

  it('編集できない役割にはバナーの操作を出さない', () => {
    mockCanEdit = false
    members = [
      { id: 'u1', displayName: '自分', avatarUrl: null, role: 'admin' },
      { id: 'v1', displayName: '鈴木（閲覧者）', avatarUrl: null, role: 'viewer' },
    ]
    defaultReviewerIds = ['v1']
    render(<ApprovalSettings orgId="o1" spaceId="s1" />)

    expect(screen.queryByText(/候補外の人/)).not.toBeInTheDocument()
  })
})
