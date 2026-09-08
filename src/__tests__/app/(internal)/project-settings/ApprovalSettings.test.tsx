import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ApprovalSettings } from '@/app/(internal)/[orgId]/project/[spaceId]/settings/ApprovalSettings'

let members = [
  { id: 'u1', displayName: '自分', avatarUrl: null, role: 'admin' },
  { id: 'i1', displayName: '田中', avatarUrl: null, role: 'editor' },
  { id: 'c1', displayName: '相手先の人', avatarUrl: null, role: 'client' },
]

vi.mock('@/lib/hooks/useSpaceMembers', () => ({
  useSpaceMembers: () => ({
    members,
    internalMembers: members.filter((m) => m.role !== 'client'),
    clientMembers: members.filter((m) => m.role === 'client'),
    loading: false,
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

beforeEach(() => {
  setDefaultReviewer.mockReset().mockResolvedValue(undefined)
  defaultReviewerIds = []
  members = [
    { id: 'u1', displayName: '自分', avatarUrl: null, role: 'admin' },
    { id: 'i1', displayName: '田中', avatarUrl: null, role: 'editor' },
    { id: 'c1', displayName: '相手先の人', avatarUrl: null, role: 'client' },
  ]
})

describe('ApprovalSettings — 既定の承認者', () => {
  it('社内メンバーだけが並ぶ（相手先は承認者にできない）', () => {
    render(<ApprovalSettings spaceId="s1" />)

    expect(screen.getByText('自分')).toBeInTheDocument()
    expect(screen.getByText('田中')).toBeInTheDocument()
    expect(screen.queryByText('相手先の人')).not.toBeInTheDocument()
  })

  it('既定になっている人はオンで表示される', () => {
    defaultReviewerIds = ['i1']
    render(<ApprovalSettings spaceId="s1" />)

    expect(screen.getByRole('switch', { name: '田中' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('switch', { name: '自分' })).toHaveAttribute('aria-checked', 'false')
  })

  it('オンにすると既定の承認者に加わる', async () => {
    render(<ApprovalSettings spaceId="s1" />)

    fireEvent.click(screen.getByRole('switch', { name: '田中' }))

    await waitFor(() => expect(setDefaultReviewer).toHaveBeenCalledWith('i1', true))
  })

  it('オフにすると既定から外れる', async () => {
    defaultReviewerIds = ['i1']
    render(<ApprovalSettings spaceId="s1" />)

    fireEvent.click(screen.getByRole('switch', { name: '田中' }))

    await waitFor(() => expect(setDefaultReviewer).toHaveBeenCalledWith('i1', false))
  })

  it('社内メンバーがいなければその旨を出す', () => {
    members = [{ id: 'c1', displayName: '相手先の人', avatarUrl: null, role: 'client' }]
    render(<ApprovalSettings spaceId="s1" />)

    expect(screen.getByText('社内メンバーがいません')).toBeInTheDocument()
  })
})
