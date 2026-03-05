'use client'

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Notebook, CalendarCheck, Plus, CaretDown, FunnelSimple, CalendarBlank, X } from '@phosphor-icons/react'
import { useInspector } from '@/components/layout'
import { toast } from 'sonner'
import { Breadcrumb } from '@/components/shared'
import { MeetingRow } from '@/components/meeting/MeetingRow'
import { MeetingInspector } from '@/components/meeting/MeetingInspector'
import { MeetingCreateSheet, type MeetingCreateData } from '@/components/meeting'
import { ProposalRow, ProposalInspector, ProposalCreateSheet } from '@/components/scheduling'
import { useMeetings } from '@/lib/hooks/useMeetings'
import { useSchedulingProposals, type ProposalDetail, type ProposalWithDetails } from '@/lib/hooks/useSchedulingProposals'
import type { Meeting } from '@/types/database'

interface MeetingsPageClientProps {
  orgId: string
  spaceId: string
}

type UnifiedItem =
  | { kind: 'meeting'; data: Meeting; sortDate: string }
  | { kind: 'proposal'; data: ProposalWithDetails; sortDate: string }

type KindFilter = 'all' | 'meeting' | 'proposal'
type DateFilter = 'all' | 'today' | 'this_week' | 'this_month' | 'past'

const KIND_OPTIONS: { value: KindFilter; label: string }[] = [
  { value: 'all', label: 'すべて' },
  { value: 'meeting', label: '会議のみ' },
  { value: 'proposal', label: '日程調整のみ' },
]

const DATE_OPTIONS: { value: DateFilter; label: string }[] = [
  { value: 'all', label: 'すべて' },
  { value: 'today', label: '今日' },
  { value: 'this_week', label: '今週' },
  { value: 'this_month', label: '今月' },
  { value: 'past', label: '過去' },
]

export function MeetingsPageClient({ orgId, spaceId }: MeetingsPageClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { setInspector } = useInspector()
  const [isCreateSheetOpen, setIsCreateSheetOpen] = useState(false)
  const [isProposalCreateOpen, setIsProposalCreateOpen] = useState(false)
  const [proposalDetail, setProposalDetail] = useState<ProposalDetail | null>(null)
  const [showCreateMenu, setShowCreateMenu] = useState(false)
  const createMenuRef = useRef<HTMLDivElement>(null)

  // Filter state
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')
  const [dateFilter, setDateFilter] = useState<DateFilter>('all')
  const [showKindMenu, setShowKindMenu] = useState(false)
  const [showDateMenu, setShowDateMenu] = useState(false)
  const kindMenuRef = useRef<HTMLDivElement>(null)
  const dateMenuRef = useRef<HTMLDivElement>(null)

  const {
    meetings,
    participants,
    loading,
    error,
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

  // Unified list: meetings + open/expired proposals
  const unifiedItems = useMemo(() => {
    const items: UnifiedItem[] = []

    for (const meeting of meetings) {
      items.push({
        kind: 'meeting',
        data: meeting,
        sortDate: meeting.held_at || meeting.created_at,
      })
    }

    for (const proposal of proposals) {
      if (proposal.status === 'open' || proposal.status === 'expired') {
        const firstSlotDate = proposal.proposal_slots?.[0]?.start_at
        items.push({
          kind: 'proposal',
          data: proposal,
          sortDate: firstSlotDate || proposal.created_at,
        })
      }
    }

    items.sort((a, b) => new Date(b.sortDate).getTime() - new Date(a.sortDate).getTime())
    return items
  }, [meetings, proposals])

  // Filtered items
  const activeFilterCount = (kindFilter !== 'all' ? 1 : 0) + (dateFilter !== 'all' ? 1 : 0)

  const filteredItems = useMemo(() => {
    return unifiedItems.filter((item) => {
      // Kind filter
      if (kindFilter !== 'all' && item.kind !== kindFilter) return false

      // Date filter
      if (dateFilter !== 'all') {
        const now = new Date()
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        const itemDate = new Date(item.sortDate)
        const itemDay = new Date(itemDate.getFullYear(), itemDate.getMonth(), itemDate.getDate())

        switch (dateFilter) {
          case 'today':
            if (itemDay.getTime() !== today.getTime()) return false
            break
          case 'this_week': {
            const weekStart = new Date(today)
            weekStart.setDate(weekStart.getDate() - weekStart.getDay())
            const weekEnd = new Date(weekStart)
            weekEnd.setDate(weekEnd.getDate() + 6)
            if (itemDay < weekStart || itemDay > weekEnd) return false
            break
          }
          case 'this_month': {
            if (
              itemDate.getFullYear() !== now.getFullYear() ||
              itemDate.getMonth() !== now.getMonth()
            ) return false
            break
          }
          case 'past':
            if (itemDay >= today) return false
            break
        }
      }

      return true
    })
  }, [unifiedItems, kindFilter, dateFilter])

  const clearFilters = useCallback(() => {
    setKindFilter('all')
    setDateFilter('all')
  }, [])

  const isLoading = loading || proposalsLoading
  const hasError = error || proposalsError

  // Close dropdown on outside click
  useEffect(() => {
    if (!showCreateMenu && !showKindMenu && !showDateMenu) return
    const handleClickOutside = (e: PointerEvent) => {
      if (showCreateMenu && createMenuRef.current && !createMenuRef.current.contains(e.target as Node)) {
        setShowCreateMenu(false)
      }
      if (showKindMenu && kindMenuRef.current && !kindMenuRef.current.contains(e.target as Node)) {
        setShowKindMenu(false)
      }
      if (showDateMenu && dateMenuRef.current && !dateMenuRef.current.contains(e.target as Node)) {
        setShowDateMenu(false)
      }
    }
    document.addEventListener('pointerdown', handleClickOutside)
    return () => document.removeEventListener('pointerdown', handleClickOutside)
  }, [showCreateMenu, showKindMenu, showDateMenu])

  // Cleanup inspector on unmount
  useEffect(() => {
    return () => {
      setInspector(null)
    }
  }, [setInspector])

  const updateQuery = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString())
      // Always clean up legacy tab param
      params.delete('tab')
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

  // ---- Meeting inspector ----
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
    // Mutual exclusivity: proposal takes priority if both params exist
    if (!selectedMeeting || selectedProposalId) {
      if (!selectedProposalId) setInspector(null)
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
            toast.error('会議の開始に失敗しました')
          }
        }}
        onEnd={async () => {
          try {
            await endMeeting(selectedMeeting.id)
          } catch {
            toast.error('会議の終了に失敗しました')
          }
        }}
      />
    )
  }, [endMeeting, participants, selectedMeeting, selectedProposalId, setInspector, startMeeting, updateQuery])

  // ---- Proposal inspector ----
  // Reset detail when switching proposals (prevents stale data flash)
  const prevProposalIdRef = useRef(selectedProposalId)
  useEffect(() => {
    if (selectedProposalId !== prevProposalIdRef.current) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProposalDetail(null)
      prevProposalIdRef.current = selectedProposalId
    }
  }, [selectedProposalId])

  useEffect(() => {
    if (!selectedProposalId) {
      if (!selectedMeetingId) setInspector(null)
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
  }, [selectedProposalId, selectedMeetingId, proposalDetail, fetchProposalDetail, setInspector, updateQuery, confirmSlot, fetchProposals])

  const handleCreateMeeting = async (data: MeetingCreateData) => {
    try {
      const created = await createMeeting({
        title: data.title,
        heldAt: data.heldAt,
        clientParticipantIds: data.clientParticipantIds,
        internalParticipantIds: data.internalParticipantIds,
      })
      setIsCreateSheetOpen(false)
      updateQuery({ meeting: created.id, proposal: null })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '会議の作成に失敗しました')
    }
  }

  const handleCreateProposal = async (input: Parameters<typeof createProposal>[0]) => {
    try {
      const created = await createProposal(input)
      setIsProposalCreateOpen(false)
      updateQuery({ proposal: created.id, meeting: null })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '日程調整の作成に失敗しました')
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

        {/* Filters */}
        <div className="ml-4 flex items-center gap-1.5">
          {/* Kind filter */}
          <div ref={kindMenuRef} className="relative">
            <button
              type="button"
              data-testid="meetings-kind-filter"
              onClick={() => { setShowKindMenu((prev) => !prev); setShowDateMenu(false) }}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg transition-colors border ${
                kindFilter !== 'all'
                  ? 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'
                  : 'text-gray-600 hover:text-gray-900 border-gray-200 hover:border-gray-300 bg-white'
              }`}
            >
              <FunnelSimple weight={kindFilter !== 'all' ? 'fill' : 'regular'} className="text-sm" />
              <span>{KIND_OPTIONS.find((o) => o.value === kindFilter)?.label ?? '種別'}</span>
            </button>
            {showKindMenu && (
              <div className="absolute top-full left-0 mt-1 z-50 bg-white rounded-lg shadow-lg border border-gray-200 min-w-[140px] py-1">
                {KIND_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => { setKindFilter(option.value); setShowKindMenu(false) }}
                    className={`w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 transition-colors ${
                      kindFilter === option.value ? 'bg-blue-50 text-blue-700' : 'text-gray-700'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Date filter */}
          <div ref={dateMenuRef} className="relative">
            <button
              type="button"
              data-testid="meetings-date-filter"
              onClick={() => { setShowDateMenu((prev) => !prev); setShowKindMenu(false) }}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg transition-colors border ${
                dateFilter !== 'all'
                  ? 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'
                  : 'text-gray-600 hover:text-gray-900 border-gray-200 hover:border-gray-300 bg-white'
              }`}
            >
              <CalendarBlank weight={dateFilter !== 'all' ? 'fill' : 'regular'} className="text-sm" />
              <span>{dateFilter !== 'all' ? DATE_OPTIONS.find((o) => o.value === dateFilter)?.label ?? '日付' : '日付'}</span>
            </button>
            {showDateMenu && (
              <div className="absolute top-full left-0 mt-1 z-50 bg-white rounded-lg shadow-lg border border-gray-200 min-w-[120px] py-1">
                {DATE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => { setDateFilter(option.value); setShowDateMenu(false) }}
                    className={`w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 transition-colors ${
                      dateFilter === option.value ? 'bg-blue-50 text-blue-700' : 'text-gray-700'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Clear filters */}
          {activeFilterCount > 0 && (
            <button
              type="button"
              data-testid="meetings-clear-filters"
              onClick={clearFilters}
              className="flex items-center gap-1 px-2 py-1.5 text-xs text-gray-500 hover:text-red-500 rounded-lg transition-colors"
              aria-label="フィルターをクリア"
            >
              <X className="text-sm" />
              <span>クリア</span>
            </button>
          )}
        </div>

        <div className="ml-auto relative" ref={createMenuRef}>
          <button
            type="button"
            data-testid="meetings-create-dropdown"
            onClick={() => setShowCreateMenu((prev) => !prev)}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="text-sm" weight="bold" />
            新規
            <CaretDown className="text-[10px]" />
          </button>
          {showCreateMenu && (
            <div className="absolute right-0 mt-1 w-48 bg-white rounded-lg shadow-popover border border-gray-200 py-1 z-10">
              <button
                type="button"
                data-testid="create-from-scheduling"
                onClick={() => {
                  setIsProposalCreateOpen(true)
                  setShowCreateMenu(false)
                }}
                className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
              >
                <CalendarCheck className="text-base text-gray-400" />
                日程調整から始める
              </button>
              <button
                type="button"
                data-testid="create-meeting-direct"
                onClick={() => {
                  setIsCreateSheetOpen(true)
                  setShowCreateMenu(false)
                }}
                className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
              >
                <Notebook className="text-base text-gray-400" />
                会議を直接作成
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Content — unified list */}
      <div className="flex-1 overflow-y-auto">
        <div className="content-wrap py-4">
          {isLoading && (
            <div className="text-center text-gray-400 py-16">読み込み中...</div>
          )}
          {!isLoading && hasError && (
            <div className="text-center text-red-500 py-16">
              読み込みに失敗しました
            </div>
          )}
          {!isLoading && !hasError && unifiedItems.length === 0 && (
            <div className="text-center text-gray-400 py-20">
              <Notebook className="text-4xl mx-auto mb-3 opacity-50" />
              <p className="text-sm">会議・日程調整はありません</p>
              <p className="text-xs mt-1 text-gray-300">
                「新規」ボタンから会議を作成しましょう
              </p>
            </div>
          )}
          {!isLoading && !hasError && unifiedItems.length > 0 && filteredItems.length === 0 && (
            <div className="text-center text-gray-400 py-20">
              <FunnelSimple className="text-4xl mx-auto mb-3 opacity-50" />
              <p className="text-sm">フィルター条件に一致する項目がありません</p>
              <button
                type="button"
                onClick={clearFilters}
                className="mt-2 text-xs text-blue-600 hover:text-blue-800 transition-colors"
              >
                フィルターをクリア
              </button>
            </div>
          )}
          {!isLoading && !hasError && filteredItems.length > 0 && (
            <div className="border-t border-gray-100">
              {filteredItems.map((item) =>
                item.kind === 'meeting' ? (
                  <MeetingRow
                    key={`meeting-${item.data.id}`}
                    meeting={item.data}
                    isSelected={item.data.id === selectedMeetingId}
                    onClick={() => updateQuery({ meeting: item.data.id, proposal: null })}
                  />
                ) : (
                  <ProposalRow
                    key={`proposal-${item.data.id}`}
                    proposal={item.data}
                    isSelected={item.data.id === selectedProposalId}
                    onClick={() => updateQuery({ proposal: item.data.id, meeting: null })}
                  />
                )
              )}
            </div>
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
