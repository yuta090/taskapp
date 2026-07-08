import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TaskReviewSection } from '@/components/review/TaskReviewSection'

const mockFrom = vi.fn()
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: (...args: unknown[]) => mockFrom(...args) }),
}))

const mockReviewCancel = vi.fn()
vi.mock('@/lib/supabase/rpc', () => ({
  rpc: {
    reviewOpen: vi.fn(),
    reviewApprove: vi.fn(),
    reviewBlock: vi.fn(),
    reviewCancel: (...args: unknown[]) => mockReviewCancel(...args),
  },
}))

vi.mock('@/lib/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { id: 'u1' }, loading: false, error: null }),
}))

// Default: current user (u1) is a plain editor, not an admin.
let mockMembers: Array<{ id: string; displayName: string; role: string }> = [
  { id: 'u1', displayName: '自分', role: 'editor' },
  { id: 'i1', displayName: '田中（社内）', role: 'editor' },
]

vi.mock('@/lib/hooks/useSpaceMembers', () => ({
  useSpaceMembers: () => ({
    members: mockMembers,
    internalMembers: mockMembers,
    getMemberName: (id: string) => mockMembers.find((m) => m.id === id)?.displayName ?? id,
  }),
}))

function mockReviewWith(review: Record<string, unknown>, approvals: Record<string, unknown>[]) {
  mockFrom.mockReturnValue({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: { ...review, review_approvals: approvals },
      error: null,
    }),
  })
}

function mockNoReview() {
  mockFrom.mockReturnValue({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  })
}

describe('TaskReviewSection — 社内承認の用語統一 (M-4)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNoReview()
  })

  it('見出しが「社内承認」を使う', async () => {
    render(<TaskReviewSection taskId="t1" spaceId="s1" orgId="o1" />)
    await waitFor(() => expect(screen.getByText('社内承認')).toBeInTheDocument())
    expect(screen.queryByText('承認フロー')).not.toBeInTheDocument()
  })

  it('「承認を依頼」ボタンが「社内承認を依頼」になる', async () => {
    render(<TaskReviewSection taskId="t1" spaceId="s1" orgId="o1" />)
    await waitFor(() => expect(screen.getByText('社内承認を依頼')).toBeInTheDocument())
  })

  it('承認者選択UIを開くとクライアント向けヒントを表示する', async () => {
    render(<TaskReviewSection taskId="t1" spaceId="s1" orgId="o1" />)
    await waitFor(() => screen.getByText('社内承認を依頼'))

    expect(
      screen.queryByText('クライアントへの確認依頼はボールを「外部」に切り替えてください')
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('社内承認を依頼'))

    expect(
      screen.getByText('クライアントへの確認依頼はボールを「外部」に切り替えてください')
    ).toBeInTheDocument()
  })
})

// S5: 指名レビュアーがスペースから外れる等で open/changes_requested のまま
// 詰んだレビューを、依頼者または space admin が取り消せるようにする。
describe('TaskReviewSection — レビューを取り消す (S5)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMembers = [
      { id: 'u1', displayName: '自分', role: 'editor' },
      { id: 'i1', displayName: '田中（社内）', role: 'editor' },
    ]
  })

  it('依頼者本人には、status=open のとき「レビューを取り消す」ボタンが表示される', async () => {
    mockReviewWith(
      { id: 'r1', status: 'open', created_by: 'u1' },
      [{ id: 'a1', reviewer_id: 'i1', state: 'pending' }]
    )
    render(<TaskReviewSection taskId="t1" spaceId="s1" orgId="o1" />)

    await waitFor(() => expect(screen.getByText('レビューを取り消す')).toBeInTheDocument())
  })

  it('依頼者でも admin でもない一般編集者には表示されない', async () => {
    mockReviewWith(
      { id: 'r1', status: 'open', created_by: 'i1' },
      [{ id: 'a1', reviewer_id: 'i1', state: 'pending' }]
    )
    render(<TaskReviewSection taskId="t1" spaceId="s1" orgId="o1" />)

    await waitFor(() => expect(screen.getByText('社内承認待ち')).toBeInTheDocument())
    expect(screen.queryByText('レビューを取り消す')).not.toBeInTheDocument()
  })

  it('space admin には、自分が依頼者でなくても表示される', async () => {
    mockMembers = [
      { id: 'u1', displayName: '自分', role: 'admin' },
      { id: 'i1', displayName: '田中（社内）', role: 'editor' },
    ]
    mockReviewWith(
      { id: 'r1', status: 'open', created_by: 'i1' },
      [{ id: 'a1', reviewer_id: 'i1', state: 'pending' }]
    )
    render(<TaskReviewSection taskId="t1" spaceId="s1" orgId="o1" />)

    await waitFor(() => expect(screen.getByText('レビューを取り消す')).toBeInTheDocument())
  })

  it('差し戻し中(changes_requested)でも取り消しボタンが表示される', async () => {
    mockReviewWith(
      { id: 'r1', status: 'changes_requested', created_by: 'u1' },
      [{ id: 'a1', reviewer_id: 'i1', state: 'blocked', blocked_reason: '修正してください' }]
    )
    render(<TaskReviewSection taskId="t1" spaceId="s1" orgId="o1" />)

    await waitFor(() => expect(screen.getByText('レビューを取り消す')).toBeInTheDocument())
  })

  it('承認済み(approved)では取り消しボタンは表示されない', async () => {
    mockReviewWith(
      { id: 'r1', status: 'approved', created_by: 'u1' },
      [{ id: 'a1', reviewer_id: 'i1', state: 'approved' }]
    )
    render(<TaskReviewSection taskId="t1" spaceId="s1" orgId="o1" />)

    await waitFor(() => expect(screen.getByText('社内承認済み')).toBeInTheDocument())
    expect(screen.queryByText('レビューを取り消す')).not.toBeInTheDocument()
  })

  it('取り消しボタン押下 → 確認ダイアログで確定すると rpc.reviewCancel が呼ばれる', async () => {
    mockReviewWith(
      { id: 'r1', status: 'open', created_by: 'u1' },
      [{ id: 'a1', reviewer_id: 'i1', state: 'pending' }]
    )
    mockReviewCancel.mockResolvedValue({ ok: true })
    render(<TaskReviewSection taskId="t1" spaceId="s1" orgId="o1" />)

    await waitFor(() => screen.getByText('レビューを取り消す'))
    fireEvent.click(screen.getByText('レビューを取り消す'))

    const confirmButton = await screen.findByRole('button', { name: '取り消す' })
    fireEvent.click(confirmButton)

    await waitFor(() =>
      expect(mockReviewCancel).toHaveBeenCalledWith(expect.anything(), { reviewId: 'r1' })
    )
  })

  it('確認ダイアログでキャンセルすると rpc.reviewCancel は呼ばれない', async () => {
    mockReviewWith(
      { id: 'r1', status: 'open', created_by: 'u1' },
      [{ id: 'a1', reviewer_id: 'i1', state: 'pending' }]
    )
    render(<TaskReviewSection taskId="t1" spaceId="s1" orgId="o1" />)

    await waitFor(() => screen.getByText('レビューを取り消す'))
    fireEvent.click(screen.getByText('レビューを取り消す'))

    const cancelButton = await screen.findByRole('button', { name: 'キャンセル' })
    fireEvent.click(cancelButton)

    expect(mockReviewCancel).not.toHaveBeenCalled()
  })

  it('取り消し後は review が cancelled 扱いとなり、「社内承認を依頼」導線が復活する', async () => {
    let call = 0
    mockFrom.mockImplementation(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockImplementation(() => {
        call += 1
        if (call === 1) {
          return Promise.resolve({
            data: {
              id: 'r1',
              status: 'open',
              created_by: 'u1',
              review_approvals: [{ id: 'a1', reviewer_id: 'i1', state: 'pending' }],
            },
            error: null,
          })
        }
        return Promise.resolve({
          data: {
            id: 'r1',
            status: 'cancelled',
            created_by: 'u1',
            review_approvals: [{ id: 'a1', reviewer_id: 'i1', state: 'pending' }],
          },
          error: null,
        })
      }),
    }))
    mockReviewCancel.mockResolvedValue({ ok: true })
    render(<TaskReviewSection taskId="t1" spaceId="s1" orgId="o1" />)

    await waitFor(() => screen.getByText('レビューを取り消す'))
    fireEvent.click(screen.getByText('レビューを取り消す'))
    fireEvent.click(await screen.findByRole('button', { name: '取り消す' }))

    await waitFor(() => expect(screen.getByText('社内承認を依頼')).toBeInTheDocument())
    expect(screen.queryByText('レビューを取り消す')).not.toBeInTheDocument()
    expect(screen.queryByText('社内承認待ち')).not.toBeInTheDocument()
  })
})

describe('TaskReviewSection — 「差戻」→「差し戻し」表記統一 (A6)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMembers = [
      { id: 'u1', displayName: '自分', role: 'editor' },
      { id: 'i1', displayName: '田中（社内）', role: 'editor' },
    ]
  })

  it('レビュアーごとの状態バッジが「差し戻し」を使う（旧: 差戻）', async () => {
    mockReviewWith(
      { id: 'r1', status: 'changes_requested', created_by: 'u1' },
      [{ id: 'a1', reviewer_id: 'i1', state: 'blocked', blocked_reason: '修正してください' }]
    )
    render(<TaskReviewSection taskId="t1" spaceId="s1" orgId="o1" />)

    await waitFor(() => expect(screen.getAllByText('差し戻し').length).toBeGreaterThanOrEqual(2))
    expect(screen.queryByText('差戻')).not.toBeInTheDocument()
  })

  it('レビュアー自身の差し戻しアクションボタンが「差し戻し」を使う（旧: 差戻）', async () => {
    mockReviewWith(
      { id: 'r1', status: 'open', created_by: 'i1' },
      [{ id: 'a1', reviewer_id: 'u1', state: 'pending' }]
    )
    render(<TaskReviewSection taskId="t1" spaceId="s1" orgId="o1" />)

    await waitFor(() => expect(screen.getByText('差し戻し')).toBeInTheDocument())
    expect(screen.queryByText('差戻')).not.toBeInTheDocument()
  })
})
