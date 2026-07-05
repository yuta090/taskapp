import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TaskReviewSection } from '@/components/review/TaskReviewSection'

const mockFrom = vi.fn()
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: (...args: unknown[]) => mockFrom(...args) }),
}))

vi.mock('@/lib/supabase/rpc', () => ({
  rpc: {
    reviewOpen: vi.fn(),
    reviewApprove: vi.fn(),
    reviewBlock: vi.fn(),
  },
}))

vi.mock('@/lib/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { id: 'u1' }, loading: false, error: null }),
}))

vi.mock('@/lib/hooks/useSpaceMembers', () => ({
  useSpaceMembers: () => ({
    internalMembers: [{ id: 'i1', displayName: '田中（社内）' }],
    getMemberName: (id: string) => (id === 'i1' ? '田中（社内）' : id),
  }),
}))

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
