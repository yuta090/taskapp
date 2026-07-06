import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MeetingsPageClient } from '@/app/(internal)/[orgId]/project/[spaceId]/meetings/MeetingsPageClient'

const mockSetInspector = vi.fn()
const mockRouterReplace = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockRouterReplace, push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/components/layout', () => ({
  useInspector: () => ({ setInspector: mockSetInspector }),
}))

vi.mock('@/lib/hooks/useMeetings', () => ({
  useMeetings: () => ({
    meetings: [],
    participants: {},
    loading: false,
    error: null,
    fetchMeetingDetail: vi.fn(),
    createMeeting: vi.fn(),
    deleteMeeting: vi.fn(),
    startMeeting: vi.fn(),
    endMeeting: vi.fn(),
    parseMinutes: vi.fn(),
    previewMinutes: vi.fn(),
  }),
}))

vi.mock('@/lib/hooks/useSchedulingProposals', () => ({
  useSchedulingProposals: () => ({
    proposals: [],
    loading: false,
    error: null,
    fetchProposals: vi.fn(),
    fetchProposalDetail: vi.fn(),
    createProposal: vi.fn(),
    confirmSlot: vi.fn(),
  }),
}))

// ProposalCreateSheet (always mounted, gated internally by its own `isOpen`
// prop) calls useCurrentUser() unconditionally — mock it directly rather
// than reconstructing the full supabase auth/session-cache chain.
vi.mock('@/lib/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: null, loading: false, error: null }),
}))

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MeetingsPageClient orgId="org-1" spaceId="space-1" />
    </QueryClientProvider>
  )
}

/**
 * B-5: the meetings empty state only hinted at the "新規" dropdown button in
 * the header ("「新規」ボタンから会議を作成しましょう") instead of offering a
 * real CTA, so users had to hunt for the header control.
 */
describe('MeetingsPageClient empty state', () => {
  it('shows a "会議を作成" button when there are no meetings/proposals', () => {
    renderPage()
    expect(screen.getByText('会議・日程調整はありません')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '会議を作成' })).toBeInTheDocument()
  })

  it('opens the meeting create sheet when the empty-state CTA is clicked', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '会議を作成' }))

    await waitFor(() => {
      expect(screen.getByText('新規会議')).toBeInTheDocument()
    })
  })
})
