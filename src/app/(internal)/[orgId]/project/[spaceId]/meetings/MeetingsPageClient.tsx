'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Notebook, CalendarCheck } from '@phosphor-icons/react'
import { useInspector } from '@/components/layout'
import { Breadcrumb } from '@/components/shared'
import { MeetingRow } from '@/components/meeting/MeetingRow'
import { MeetingInspector } from '@/components/meeting/MeetingInspector'
import { MeetingCreateSheet, type MeetingCreateData } from '@/components/meeting'
import { ProposalRow, ProposalInspector, ProposalCreateSheet } from '@/components/scheduling'
import { useMeetings } from '@/lib/hooks/useMeetings'
import { useSchedulingProposals, type ProposalDetail } from '@/lib/hooks/useSchedulingProposals'
import type { Meeting } from '@/types/database'

interface MeetingsPageClientProps {
  orgId: string
  spaceId: string
}

type TabId = 'meetings' | 'scheduling'

export function MeetingsPageClient({ orgId, spaceId }: MeetingsPageClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { setInspector } = useInspector()
  const [isCreateSheetOpen, setIsCreateSheetOpen] = useState(false)
  const [isProposalCreateOpen, setIsProposalCreateOpen] = useState(false)
  const [proposalDetail, setProposalDetail] = useState<ProposalDetail | null>(null)

  const activeTab = (searchParams.get('tab') as TabId) || 'meetings'

  const {
    meetings,
    participants,
    loading,
    error,
    fetchMeetings,
    fetchMeetingDetail,
    createMeeting,
    startMeeting,
    endMeeting,
  } = useMeetings({ orgId, spaceId })

  const {
    proposals,
    loading: proposalsLoading,
    error: proposalsError,
    fetchProposals,
    fetchProposalDetail,
    createProposal,
    confirmSlot,
  } = useSchedulingProposals({ orgId, spaceId })

  const projectBasePath = `/${orgId}/project/${spaceId}/meetings`
  const selectedMeetingId = searchParams.get('meeting')
  const selectedProposalId = searchParams.get('proposal')

  useEffect(() => {
    void fetchMeetings()
  }, [fetchMeetings])

  useEffect(() => {
    if (activeTab === 'scheduling') {
      void fetchProposals()
    }
  }, [activeTab, fetchProposals])

  useEffect(() => {
    return () => {
      setInspector(null)
    }
  }, [setInspector])

  const updateQuery = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString())
      Object.entries(updates).forEach(([key, value]) => {
        if (value === null) {
          params.delete(key)
        } else {
          params.set(key, value)
        }
      })
      const query = params.toString()
      router.replace(query ? `${projectBasePath}?${query}` : projectBasePath)
    },
    [router, projectBasePath, searchParams]
  )

  const handleTabChange = useCallback(
    (tab: TabId) => {
      // Clear selections when switching tabs
      updateQuery({
        tab: tab === 'meetings' ? null : tab,
        meeting: null,
        proposal: null,
      })
      setInspector(null)
    },
    [updateQuery, setInspector]
  )

  // ---- Meetings tab logic ----
  const selectedMeeting: Meeting | null = useMemo(() => {
    if (!selectedMeetingId) return null
    return meetings.find((meeting) => meeting.id === selectedMeetingId) ?? null
  }, [meetings, selectedMeetingId])

  useEffect(() => {
    if (selectedMeeting && selectedMeeting.minutes_md === undefined) {
      void fetchMeetingDetail(selectedMeeting.id)
    }
  }, [selectedMeeting, fetchMeetingDetail])

  useEffect(() => {
    if (activeTab !== 'meetings') return

    if (!selectedMeeting) {
      setInspector(null)
      return
    }

    setInspector(
      <MeetingInspector
        meeting={selectedMeeting}
        participants={participants[selectedMeeting.id] || []}
        onClose={() => updateQuery({ meeting: null })}
        onStart={async () => {
          try {
            await startMeeting(selectedMeeting.id)
          } catch {
            alert('会議の開始に失敗しました')
          }
        }}
        onEnd={async () => {
          try {
            await endMeeting(selectedMeeting.id)
          } catch {
            alert('会議の終了に失敗しました')
          }
        }}
      />
    )
  }, [activeTab, endMeeting, participants, selectedMeeting, setInspector, startMeeting, updateQuery])

  // ---- Scheduling tab logic ----
  useEffect(() => {
    if (activeTab !== 'scheduling') return

    if (!selectedProposalId) {
      setInspector(null)
      // Reset detail when no proposal selected — intentional state sync
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProposalDetail(null)
      return
    }

    setInspector(
      <ProposalInspector
        proposal={proposalDetail}
        proposalId={selectedProposalId}
        fetchProposalDetail={async (id) => {
          const detail = await fetchProposalDetail(id)
          if (detail) setProposalDetail(detail)
          return detail
        }}
        onClose={() => updateQuery({ proposal: null })}
        onConfirm={async (proposalId, slotId) => {
          const result = await confirmSlot(proposalId, slotId)
          await fetchProposals()
          return result
        }}
      />
    )
  }, [activeTab, selectedProposalId, proposalDetail, fetchProposalDetail, setInspector, updateQuery, confirmSlot, fetchProposals])

  const handleOpenCreateSheet = () => {
    setIsCreateSheetOpen(true)
  }

  const handleCreateMeeting = async (data: MeetingCreateData) => {
    try {
      const created = await createMeeting({
        title: data.title,
        heldAt: data.heldAt,
        clientParticipantIds: data.clientParticipantIds,
        internalParticipantIds: data.internalParticipantIds,
      })
      setIsCreateSheetOpen(false)
      updateQuery({ meeting: created.id })
    } catch (err) {
      const message = err instanceof Error ? err.message : '会議の作成に失敗しました'
      alert(message)
    }
  }

  const handleCreateProposal = async (input: Parameters<typeof createProposal>[0]) => {
    try {
      const created = await createProposal(input)
      setIsProposalCreateOpen(false)
      updateQuery({ proposal: created.id })
    } catch (err) {
      const message = err instanceof Error ? err.message : '日程調整の作成に失敗しました'
      alert(message)
    }
  }

  const breadcrumbItems = [
    { label: 'Webリニューアル', href: `/${orgId}/project/${spaceId}` },
    { label: '議事録' },
  ]

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <header className="h-12 border-b border-gray-100 flex items-center px-5 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Notebook className="text-lg text-gray-500" />
          <Breadcrumb items={breadcrumbItems} />
        </div>
        <div className="ml-auto">
          {activeTab === 'meetings' ? (
            <button
              type="button"
              data-testid="meetings-create"
              onClick={handleOpenCreateSheet}
              className="px-3 py-1.5 text-xs font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 transition-colors"
            >
              新規会議
            </button>
          ) : (
            <button
              type="button"
              data-testid="proposal-create-btn"
              onClick={() => setIsProposalCreateOpen(true)}
              className="px-3 py-1.5 text-xs font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 transition-colors"
            >
              + 新規日程調整
            </button>
          )}
        </div>
      </header>

      {/* Tabs */}
      <div className="flex border-b border-gray-100 px-5 flex-shrink-0">
        {[
          { id: 'meetings' as TabId, label: '会議', icon: <Notebook className="text-sm" /> },
          { id: 'scheduling' as TabId, label: '日程調整', icon: <CalendarCheck className="text-sm" /> },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => handleTabChange(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'text-gray-900 border-gray-900'
                : 'text-gray-500 border-transparent hover:text-gray-700'
            }`}
            data-testid={`meetings-tab-${tab.id}`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="content-wrap py-4">
          {/* Meetings Tab */}
          {activeTab === 'meetings' && (
            <>
              {loading && (
                <div className="text-center text-gray-400 py-16">読み込み中...</div>
              )}
              {error && (
                <div className="text-center text-red-500 py-16">
                  読み込みに失敗しました
                </div>
              )}
              {!loading && !error && meetings.length === 0 && (
                <div className="text-center text-gray-400 py-20">
                  <Notebook className="text-4xl mx-auto mb-3 opacity-50" />
                  <p className="text-sm">会議はありません</p>
                  <p className="text-xs mt-1 text-gray-300">space: {spaceId}</p>
                </div>
              )}
              {!loading && !error && meetings.length > 0 && (
                <div className="border-t border-gray-100">
                  {meetings.map((meeting) => (
                    <MeetingRow
                      key={meeting.id}
                      meeting={meeting}
                      isSelected={meeting.id === selectedMeetingId}
                      onClick={() => updateQuery({ meeting: meeting.id })}
                    />
                  ))}
                </div>
              )}
            </>
          )}

          {/* Scheduling Tab */}
          {activeTab === 'scheduling' && (
            <>
              {proposalsLoading && (
                <div className="text-center text-gray-400 py-16">読み込み中...</div>
              )}
              {proposalsError && (
                <div className="text-center text-red-500 py-16">
                  読み込みに失敗しました
                </div>
              )}
              {!proposalsLoading && !proposalsError && proposals.length === 0 && (
                <div className="text-center text-gray-400 py-20">
                  <CalendarCheck className="text-4xl mx-auto mb-3 opacity-50" />
                  <p className="text-sm">まだ日程調整がありません</p>
                  <p className="text-xs mt-1 text-gray-300">
                    「+ 新規日程調整」ボタンで候補日を提案しましょう
                  </p>
                </div>
              )}
              {!proposalsLoading && !proposalsError && proposals.length > 0 && (
                <div className="border-t border-gray-100">
                  {proposals.map((proposal) => (
                    <ProposalRow
                      key={proposal.id}
                      proposal={proposal}
                      isSelected={proposal.id === selectedProposalId}
                      onClick={() => updateQuery({ proposal: proposal.id })}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Meeting Create Sheet */}
      <MeetingCreateSheet
        spaceId={spaceId}
        isOpen={isCreateSheetOpen}
        onClose={() => setIsCreateSheetOpen(false)}
        onSubmit={handleCreateMeeting}
      />

      {/* Proposal Create Sheet */}
      <ProposalCreateSheet
        orgId={orgId}
        spaceId={spaceId}
        isOpen={isProposalCreateOpen}
        onClose={() => setIsProposalCreateOpen(false)}
        onSubmit={handleCreateProposal}
      />
    </div>
  )
}
