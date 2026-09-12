'use client'

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { Notebook, CalendarCheck, Plus, CaretDown, FunnelSimple, CalendarBlank, X } from '@phosphor-icons/react'
import { useInspector, useShellFullscreen } from '@/components/layout'
import { toast } from 'sonner'
import { Breadcrumb, ErrorRetry } from '@/components/shared'
import { MeetingRow } from '@/components/meeting/MeetingRow'
import { MeetingInspector } from '@/components/meeting/MeetingInspector'
import { MeetingCreateSheet, type MeetingCreateData } from '@/components/meeting'
import { MinutesDocumentView, type MinutesDocumentViewHandle } from '@/components/meeting/MinutesDocumentView'
import { ProposalRow, ProposalInspector, ProposalCreateSheet } from '@/components/scheduling'
import { useMeetings } from '@/lib/hooks/useMeetings'
// 競合の型は、hooks ではなくモックされない置き場から取る（理由は errors.ts のコメント）
import { MinutesConflictError } from '@/lib/minutes/errors'
import { useSpaceName } from '@/lib/hooks/useSpaceName'
import { useIsMobile } from '@/lib/hooks/useIsMobile'
import { useCanEditSpace } from '@/lib/hooks/useCanEditSpace'
import { useSchedulingProposals, type ProposalDetail, type ProposalWithDetails } from '@/lib/hooks/useSchedulingProposals'
import type { Meeting } from '@/types/database'
import { AnnouncementBell } from '@/components/announcement/AnnouncementBell'
import { MEETING_QUERY_PARAM, PROPOSAL_QUERY_PARAM } from '@/lib/navigation/meetingLinks'

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
  const spaceName = useSpaceName(spaceId)
  const searchParams = useSearchParams()
  const { setInspector } = useInspector()
  // 議事録の「全画面」表示（Wiki と同じ）。状態は画面の枠（AppShell）が持つ。呼ぶのはここ
  // だけにして MinutesDocumentView には props で渡す — MinutesDocumentView は AppShell の
  // 外（単体テスト）でも直接マウントされるため、あちら側では useShellFullscreen を呼べない。
  const { fullscreen, setFullscreen } = useShellFullscreen()
  const isMobile = useIsMobile()
  const { canEdit } = useCanEditSpace(spaceId, orgId)
  const [isCreateSheetOpen, setIsCreateSheetOpen] = useState(false)
  const [isProposalCreateOpen, setIsProposalCreateOpen] = useState(false)
  const [proposalDetail, setProposalDetail] = useState<ProposalDetail | null>(null)
  const [showCreateMenu, setShowCreateMenu] = useState(false)
  const createMenuRef = useRef<HTMLDivElement>(null)
  // モバイルでは文書ビューを開いても会議詳細(Inspector)は自動で出さず、情報ボタンで開く
  // （Wiki の showInfo と同じ考え方。オーバーレイ禁止のためモバイルはシート表示）
  const [showInfo, setShowInfo] = useState(false)
  // 議事録の文書ビュー。タスク化直後に「詳細を取り直して基準を更新→エディタを作り直す」ため、
  // key に含めて丸ごと再マウントする（目印がチップになった最新の本文で作り直す）
  const [minutesReloadToken, setMinutesReloadToken] = useState(0)
  const minutesViewRef = useRef<MinutesDocumentViewHandle>(null)
  // HIGH-1: タスク化している間はエディタを読み取り専用にする
  const [isTaskifying, setIsTaskifying] = useState(false)

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
    fetchMeetings,
    fetchMeetingDetail,
    createMeeting,
    deleteMeeting,
    startMeeting,
    endMeeting,
    parseMinutes,
    previewMinutes,
    updateMinutes,
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
  const selectedMeetingId = searchParams.get(MEETING_QUERY_PARAM)
  const selectedProposalId = searchParams.get(PROPOSAL_QUERY_PARAM)

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

  // 全画面表示中はEscで抜ける（Wiki(WikiPageClient.tsx)と同じ。IME変換確定のEscでは抜けない）
  useEffect(() => {
    if (!fullscreen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return
      if (e.key === 'Escape') setFullscreen(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [fullscreen, setFullscreen])

  // 会議一覧の画面を離れたら全画面表示も解除する（次に開いた画面でLeftNavが消えたままにならないように）
  useEffect(() => () => setFullscreen(false), [setFullscreen])


  // AppShell が公開している setFullscreen は boolean だけを受ける形なので、
  // 関数で反転する書き方はできない（今の値を見て渡す）。
  const handleToggleFullscreen = useCallback(() => {
    setFullscreen(!fullscreen)
  }, [fullscreen, setFullscreen])

  // 表示速度: サーバーとの往復を避けるため router.replace ではなく history.replaceState で
  // URL だけを変える（手本: TasksPageClient.tsx の syncUrlWithState）。useSearchParams は
  // これに追従する。
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
      const newUrl = query ? `${projectBasePath}?${query}` : projectBasePath
      window.history.replaceState(null, '', newUrl)
    },
    [projectBasePath, searchParams]
  )

  // 議事録を閉じて一覧へ戻るときは全画面表示も必ず解除する
  // （戻さないと、次に別の会議を開いたときも左メニューが消えたままになる）。
  const closeMinutesDocument = useCallback(() => {
    setFullscreen(false)
    updateQuery({ meeting: null })
  }, [setFullscreen, updateQuery])

  // MEDIUM-B: Inspector の×（一覧へ戻る）から離れるときは、保存されていない書きかけが
  // あれば確認してから戻る（文書ビュー自身の「戻る」ボタンは内部で同じ確認をしてから
  // onBack を呼ぶだけなので、ここでは Inspector 側からの離脱だけ確認を挟む）。
  const handleCloseFromInspector = useCallback(async () => {
    const ok = (await minutesViewRef.current?.confirmLeave()) ?? true
    if (!ok) return
    closeMinutesDocument()
  }, [closeMinutesDocument])

  // ---- Meeting inspector ----
  const selectedMeeting: Meeting | null = useMemo(() => {
    if (!selectedMeetingId) return null
    return meetings.find((meeting) => meeting.id === selectedMeetingId) ?? null
  }, [meetings, selectedMeetingId])

  // 議事録の文書ビューが出ていないときは全画面を解除する（Wiki の WikiPageClient.tsx が
  // 「ページが無くなったら解除」を持っているのと同じ保険）。全画面で書いている最中に、
  // ほかの人がその会議を消す／日程調整に切り替わると、出るのは会議一覧なのに LeftNav が
  // 消えたままになり、「全画面を閉じる」ボタンも議事録側にあるので出口が Esc だけになる。
  const isMinutesDocumentOpen = !!selectedMeeting && !selectedProposalId
  useEffect(() => {
    if (!isMinutesDocumentOpen) setFullscreen(false)
  }, [isMinutesDocumentOpen, setFullscreen])

  // 会議を切り替えたら、モバイルの情報シート表示は毎回閉じ直す
  // （前の会議で開いていた状態のまま次の会議に持ち越さない）
  useEffect(() => {
    setShowInfo(false)
  }, [selectedMeetingId])

  useEffect(() => {
    // Mutual exclusivity: proposal takes priority if both params exist
    if (!selectedMeeting || selectedProposalId) {
      if (!selectedProposalId) setInspector(null)
      return
    }

    // モバイル: 文書ビューを開いても会議詳細は自動で出さず、情報ボタンで開いたときだけ表示する
    // （Wiki の showInfo と同じ。オーバーレイ禁止のためモバイルはシート表示）。
    // 全画面表示中も同様に閉じる（Wiki の isFullscreen と同じ。全画面は本文を広く使うためのもの
    // なので、右側のインスペクターは出さない）。
    if ((isMobile && !showInfo) || fullscreen) {
      setInspector(null)
      return
    }

    setInspector(
      <MeetingInspector
        meeting={selectedMeeting}
        participants={participants[selectedMeeting.id] || []}
        onClose={() => (isMobile ? setShowInfo(false) : void handleCloseFromInspector())}
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
        onDelete={async () => {
          try {
            await deleteMeeting(selectedMeeting.id)
            toast.success('会議を削除しました')
          } catch (err) {
            toast.error(err instanceof Error ? err.message : '会議の削除に失敗しました')
            throw err
          }
        }}
        // HIGH-N3: 本文は文書ビューの「サーバーにあると分かっている生の本文」から渡す。
        // 一覧のキャッシュ(selectedMeeting.minutes_md)は2分で古くなり得るため、それには
        // 頼らない（届いていなければキャッシュへフォールバックする）。
        onPreviewMinutes={(meetingId) => {
          const minutesMd = minutesViewRef.current?.getKnownRaw() ?? selectedMeeting.minutes_md ?? ''
          return previewMinutes(meetingId, minutesMd)
        }}
        // HIGH-1: 書けない人にはタスク化を渡さない
        onCreateTasks={
          canEdit
            ? async (meetingId) => {
                setIsTaskifying(true)
                try {
                  // タスク化の直前に、文書ビューの保留中の保存（デバウンス待ち）を即座に流す。
                  // 競合中・保存失敗・通信中なら例外になる（確定していない本文を渡さないため）。
                  let flushedContent: string
                  try {
                    flushedContent = await minutesViewRef.current!.flushPendingSave()
                  } catch (err) {
                    const message = err instanceof Error ? err.message : '議事録を保存できませんでした'
                    toast.error(message)
                    throw err
                  }

                  // RPCを呼ぶ直前にもう一度サーバーの状態を確かめる（flush確定〜RPC呼び出しの
                  // 一瞬に、別の場所で書き換えられていないか）。判定は保存(0行)のときと同じ:
                  // updated_atが同じ、または本文自体が変わっていなければ基準を差し替えて通す。
                  // 本文が本当に違えば競合の帯を出して止める（HIGH-A）。
                  try {
                    await minutesViewRef.current!.ensureUpToDate()
                  } catch (err) {
                    const message =
                      err instanceof Error
                        ? err.message
                        : '議事録が別の場所で更新されたため、タスク化を中止しました'
                    toast.error(message)
                    throw err
                  }

                  // DB 側でも「渡した本文が、いま DB にある本文と同じか」を確かめる。
                  // 上の確認〜ここまでの隙間に誰かが書いていたら、DB は何も書かずに断る
                  // （作りかけのタスクも同じトランザクションで巻き戻る）。その場合は
                  // 保存が0行だったときと同じ競合の帯を出し、「最新を読み込む」で復帰させる。
                  let result: Awaited<ReturnType<typeof parseMinutes>>
                  try {
                    result = await parseMinutes(meetingId, flushedContent)
                  } catch (err) {
                    if (err instanceof MinutesConflictError) {
                      minutesViewRef.current?.markConflict()
                      toast.error(err.message)
                    }
                    throw err
                  }

                  // 議事録は rpc_parse_meeting_minutes がサーバー側で書き換える（行末に目印を
                  // 足す）ため、詳細を取り直して文書ビューを作り直す。取り直しは別に try する
                  // （タスクはできたのに「失敗しました」と出さないため）。
                  try {
                    await fetchMeetingDetail(meetingId)
                  } catch {
                    // 無視。次に開いたときの取り直しに委ねる
                  }
                  setMinutesReloadToken((t) => t + 1)

                  if (result.createdCount > 0) {
                    toast.success(`${result.createdCount}件のタスクを作成しました`)
                  } else {
                    toast.info('タスク化できる決定事項はありませんでした')
                  }
                  return result
                } finally {
                  setIsTaskifying(false)
                }
              }
            : undefined
        }
      />
    )
  }, [
    endMeeting,
    deleteMeeting,
    participants,
    selectedMeeting,
    selectedProposalId,
    setInspector,
    startMeeting,
    updateQuery,
    parseMinutes,
    previewMinutes,
    isMobile,
    showInfo,
    fullscreen,
    fetchMeetingDetail,
    canEdit,
    handleCloseFromInspector,
  ])

  // ---- Proposal inspector ----
  // Reset detail when switching proposals (prevents stale data flash)
  const prevProposalIdRef = useRef(selectedProposalId)
  useEffect(() => {
    if (selectedProposalId !== prevProposalIdRef.current) {
      setProposalDetail(null)
      prevProposalIdRef.current = selectedProposalId
    }
  }, [selectedProposalId])

  useEffect(() => {
    if (!selectedProposalId) {
      if (!selectedMeetingId) setInspector(null)
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
    { label: spaceName || 'プロジェクト', href: `/${orgId}/project/${spaceId}` },
    { label: '議事録' },
  ]

  // 議事録の文書ビュー（Wiki のエディタビューと同じ考え方: 選んだら一覧を丸ごと
  // 差し替える。日程調整（proposal）は文書ビューを持たないため対象外のまま今の表示に留まる）
  if (selectedMeeting && !selectedProposalId) {
    return (
      <MinutesDocumentView
        key={`${selectedMeeting.id}-${minutesReloadToken}`}
        ref={minutesViewRef}
        orgId={orgId}
        spaceId={spaceId}
        meeting={selectedMeeting}
        canEdit={canEdit}
        forceReadOnly={isTaskifying}
        onBack={closeMinutesDocument}
        onOpenInfo={() => setShowInfo(true)}
        updateMinutes={updateMinutes}
        fetchMeetingDetail={fetchMeetingDetail}
        fullscreen={fullscreen}
        onToggleFullscreen={handleToggleFullscreen}
      />
    )
  }

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
                  : 'text-gray-600 hover:text-gray-900 border-gray-200 hover:border-gray-300 bg-surface'
              }`}
            >
              <FunnelSimple weight={kindFilter !== 'all' ? 'fill' : 'regular'} className="text-sm" />
              <span>{KIND_OPTIONS.find((o) => o.value === kindFilter)?.label ?? '種別'}</span>
            </button>
            {showKindMenu && (
              <div className="absolute top-full left-0 mt-1 z-50 bg-surface rounded-lg shadow-lg border border-gray-200 min-w-[140px] py-1">
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
                  : 'text-gray-600 hover:text-gray-900 border-gray-200 hover:border-gray-300 bg-surface'
              }`}
            >
              <CalendarBlank weight={dateFilter !== 'all' ? 'fill' : 'regular'} className="text-sm" />
              <span>{dateFilter !== 'all' ? DATE_OPTIONS.find((o) => o.value === dateFilter)?.label ?? '日付' : '日付'}</span>
            </button>
            {showDateMenu && (
              <div className="absolute top-full left-0 mt-1 z-50 bg-surface rounded-lg shadow-lg border border-gray-200 min-w-[120px] py-1">
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
            <div className="absolute right-0 mt-1 w-48 bg-surface rounded-lg shadow-popover border border-gray-200 py-1 z-10">
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
        {/* お知らせベル。ヘッダーの一番右に置く。この目印(data-header-bell)があると、
            AppShell がページ上部に出す「ベルだけの1行」が globals.css の :has() で消える。
            モバイルは AppShell のヘッダーにベルがあるので md 未満では出さない。 */}
        <div data-header-bell className="hidden md:block ml-2">
          <AnnouncementBell />
        </div>
      </header>

      {/* Content — unified list */}
      <div className="flex-1 overflow-y-auto">
        <div className="content-wrap py-4">
          {isLoading && (
            <div className="text-center text-gray-400 py-16">読み込み中...</div>
          )}
          {!isLoading && hasError && (
            <ErrorRetry
              onRetry={() => {
                fetchMeetings()
                fetchProposals()
              }}
            />
          )}
          {!isLoading && !hasError && unifiedItems.length === 0 && (
            <div className="text-center text-gray-400 py-20">
              <Notebook className="text-4xl mx-auto mb-3 opacity-50" />
              <p className="text-sm mb-3">会議・日程調整はありません</p>
              <button
                type="button"
                onClick={() => setIsCreateSheetOpen(true)}
                className="inline-flex items-center gap-1.5 h-8 rounded-md px-3 text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-500 transition-colors"
              >
                <Plus weight="bold" />
                会議を作成
              </button>
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
