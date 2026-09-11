'use client'

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { BookOpen, Plus, ArrowLeft, Sparkle, Info } from '@phosphor-icons/react'
import { useInspector } from '@/components/layout'
import { useIsMobile } from '@/lib/hooks/useIsMobile'
import { WikiPageRow, type WikiRowMember } from '@/components/wiki/WikiPageRow'
import { WikiListToolbar } from '@/components/wiki/WikiListToolbar'
import { WikiPageInspector } from '@/components/wiki/WikiPageInspector'
import { WikiCreateSheet } from '@/components/wiki/WikiCreateSheet'
import { WikiEditorDynamic } from '@/components/wiki/WikiEditorDynamic'
import { PresetApplicator } from '@/components/space/PresetApplicator'
import { EmptyState } from '@/components/shared'
import { useWikiPages, type UpdateWikiPageInput } from '@/lib/hooks/useWikiPages'
import { useMilestones } from '@/lib/hooks/useMilestones'
import { useSpaceMembers } from '@/lib/hooks/useSpaceMembers'
import { useCurrentUser } from '@/lib/hooks/useCurrentUser'
import { useWikiMilestoneLinks } from '@/lib/hooks/useWikiMilestoneLinks'
import {
  applyWikiListView,
  buildWikiTree,
  DEFAULT_WIKI_FILTERS,
  filterWikiPages,
  flattenWikiTree,
  groupWikiPagesByMilestone,
  resolveWikiMilestones,
  type WikiTreeNode,
  pruneWikiTreeToMatches,
  type WikiListFilters,
  EMPTY_MILESTONE_LIST,
} from '@/lib/wiki/listView'
import { useWikiListPrefs } from '@/lib/wiki/listPrefs'
import type { Milestone, WikiPage, WikiPageVersion } from '@/types/database'
import { AnnouncementBell } from '@/components/announcement/AnnouncementBell'
import { SAVING } from '@/lib/design/tokens'

// 表示モード外では計算せず共有の空配列を返す（毎レンダー新しい [] を作らない）
const EMPTY_TREE: WikiTreeNode[] = []
const EMPTY_GROUPS: ReturnType<typeof groupWikiPagesByMilestone> = []
// 所属マイルストーンが無いページの行に渡す共有の空配列（毎レンダー新しい [] を作らない）。
// resolveWikiMilestones も同じ意図で EMPTY_MILESTONE_LIST を入れるので、通常はそちらが返る。
const EMPTY_PAGE_MILESTONES: Milestone[] = EMPTY_MILESTONE_LIST

interface WikiPageClientProps {
  orgId: string
  spaceId: string
}

export function WikiPageClient({ orgId, spaceId }: WikiPageClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { setInspector } = useInspector()
  const isMobile = useIsMobile()
  // On mobile, opening a page shows the editor directly; the page-info inspector
  // is opened on demand (info button) instead of auto-overlaying the editor.
  const [showInfo, setShowInfo] = useState(false)
  const [isCreateSheetOpen, setIsCreateSheetOpen] = useState(false)
  const [activePage, setActivePage] = useState<WikiPage | null>(null)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null)
  const savedTimerRef = useRef<NodeJS.Timeout | null>(null)
  const [showPresetApplicator, setShowPresetApplicator] = useState(false)

  const {
    pages,
    loading,
    autoCreatedPageId,
    fetchPages,
    createPage,
    updatePage,
    deletePage,
    fetchPage,
    fetchVersions,
  } = useWikiPages({ orgId, spaceId })
  const { milestones } = useMilestones({ spaceId })
  const milestonesEmpty = pages.length === 0 ? milestones.length === 0 : null

  // Wiki 一覧の絞り込み・並べ替え・表示項目（PR1: 一覧強化）
  const [filters, setFilters] = useState<WikiListFilters>(DEFAULT_WIKI_FILTERS)
  const [prefs, setPrefs] = useWikiListPrefs()
  const { members } = useSpaceMembers(spaceId)
  const { user: currentUser } = useCurrentUser()
  // PR4: 所属マイルストーン = page.milestone_id ∪ タスク参照。既存4本と並列で取得する。
  const { linksByPageId } = useWikiMilestoneLinks(orgId, spaceId)

  // ページ id → 所属マイルストーン一覧（union・milestones の並び順）。行のチップ・グループ化の両方で使う。
  const milestonesByPageId = useMemo(
    () => resolveWikiMilestones(pages, linksByPageId, milestones),
    [pages, linksByPageId, milestones]
  )
  const getPageMilestones = useCallback(
    (pageId: string): Milestone[] => milestonesByPageId.get(pageId) ?? EMPTY_PAGE_MILESTONES,
    [milestonesByPageId]
  )

  const memberMap = useMemo(() => {
    const map = new Map<string, WikiRowMember>()
    for (const member of members) {
      map.set(member.id, { name: member.displayName, avatarUrl: member.avatarUrl })
    }
    return map
  }, [members])

  const getMember = useCallback(
    (userId: string): WikiRowMember | null => memberMap.get(userId) ?? null,
    [memberMap]
  )
  // 名前が引けない人（読み込み中・退会済み）は空文字＝並べ替えでは先頭/末尾にまとまる
  const getAuthorName = useCallback(
    (userId: string): string => memberMap.get(userId)?.name ?? '',
    [memberMap]
  )

  const displayedPages = useMemo(
    () => applyWikiListView(pages, filters, prefs.sort, getAuthorName),
    [pages, filters, prefs.sort, getAuthorName]
  )

  const isFiltering = filters.query.trim() !== '' || filters.tags.length > 0 || filters.authorIds.length > 0

  // フォルダ表示: 絞り込み中は一致した行とその祖先だけを残してからツリーを組む。
  // ピン留めは根の並びだけに影響させ、子の並びは崩さない（buildWikiTree の sort_order のまま）。
  const folderTree = useMemo(() => {
    if (prefs.view !== 'folder') return EMPTY_TREE
    let sourcePages = pages
    if (isFiltering) {
      const matchedIds = new Set(filterWikiPages(pages, filters, getAuthorName).map(p => p.id))
      sourcePages = pruneWikiTreeToMatches(pages, matchedIds)
    }
    const tree = buildWikiTree(sourcePages)
    const pinnedRoots = [...tree.filter(n => n.page.pinned_at != null)].sort(
      (a, b) => new Date(a.page.pinned_at as string).getTime() - new Date(b.page.pinned_at as string).getTime()
    )
    const restRoots = tree.filter(n => n.page.pinned_at == null)
    return [...pinnedRoots, ...restRoots]
  }, [pages, filters, getAuthorName, isFiltering, prefs.view])

  // 絞り込み中は折りたたみを無視する（祖先が閉じたままだと一致した行が画面から消える）
  const flatFolderRows = useMemo(
    () => flattenWikiTree(folderTree, isFiltering ? new Set<string>() : new Set(prefs.collapsedIds)),
    [folderTree, prefs.collapsedIds, isFiltering]
  )

  // マイルストーン別表示: 絞り込み・並べ替え・ピン留め済みの表示配列をそのままグループ化する。
  // 1ページが複数グループに出てよい（PR4）ため milestonesByPageId を渡す。
  const milestoneGroups = useMemo(
    () =>
      prefs.view === 'milestone'
        ? groupWikiPagesByMilestone(displayedPages, milestones, milestonesByPageId)
        : EMPTY_GROUPS,
    [displayedPages, milestones, milestonesByPageId, prefs.view]
  )

  // マイルストーン別表示の「延べ」件数（1ページが複数グループに出るぶん増える）。
  const groupedRowCount = useMemo(
    () => (prefs.view === 'milestone' ? milestoneGroups.reduce((sum, g) => sum + g.pages.length, 0) : undefined),
    [milestoneGroups, prefs.view]
  )

  // prefs 全体に依存させない（依存すると並べ替え等を触るたびに関数が変わり、memo 化した全行が再描画される）
  const handleToggleCollapse = useCallback(
    (pageId: string) => {
      setPrefs(prev => ({
        ...prev,
        collapsedIds: prev.collapsedIds.includes(pageId)
          ? prev.collapsedIds.filter(id => id !== pageId)
          : [...prev.collapsedIds, pageId],
      }))
    },
    [setPrefs]
  )

  const projectBasePath = `/${orgId}/project/${spaceId}/wiki`
  const selectedPageId = searchParams.get('page')

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

  // Auto-navigate to default page when it's first created
  const autoNavigatedRef = useRef(false)
  useEffect(() => {
    if (autoCreatedPageId && !selectedPageId && !autoNavigatedRef.current) {
      autoNavigatedRef.current = true
      updateQuery({ page: autoCreatedPageId })
    }
  }, [autoCreatedPageId, selectedPageId, updateQuery])

  // Reset preset applicator when pages exist
  const effectiveShowPresetApplicator = showPresetApplicator && pages.length === 0

  // Cleanup inspector on unmount
  useEffect(() => {
    return () => {
      setInspector(null)
    }
  }, [setInspector])

  // Load active page content when selected
  useEffect(() => {
    if (!selectedPageId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset state when no page selected
      setActivePage(null)
      setInspector(null)
      return
    }

    // Clear timers from previous page
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    setSaveStatus('idle')
     
    setShowInfo(false)

    let cancelled = false
    const load = async () => {
      const page = await fetchPage(selectedPageId)
      if (!cancelled) {
        setActivePage(page) // null if not found — clears stale state
      }
    }
    load()
    return () => { cancelled = true }
  }, [selectedPageId, fetchPage, setInspector])

  // ページ情報パネルの「タスクからの参照」（読み取り専用）。手動選択(milestone_id)は含めず、
  // タスク参照だけを渡す（手動選択は上のセレクトで既に見えているため）。
  const taskLinkedMilestonesForActivePage = useMemo(() => {
    if (!activePage) return undefined
    const ids = linksByPageId.get(activePage.id)
    if (!ids || ids.length === 0) return undefined
    const idSet = new Set(ids)
    return milestones.filter(m => idSet.has(m.id))
  }, [activePage, linksByPageId, milestones])

  // Set inspector when active page changes.
  // Desktop: inspector sits alongside the editor (auto-open).
  // Mobile: inspector is a full-screen sheet, so only open it on demand (showInfo)
  // to avoid it covering the editor the moment a page is opened.
  useEffect(() => {
    if (!activePage || (isMobile && !showInfo)) {
      setInspector(null)
      return
    }

    const handleUpdate = async (updates: UpdateWikiPageInput) => {
      await updatePage(activePage.id, updates)
      // Re-fetch page for fresh data
      const fresh = await fetchPage(activePage.id)
      if (fresh) setActivePage(fresh)
    }

    const handleDelete = async () => {
      await deletePage(activePage.id)
      updateQuery({ page: null })
    }

    const handleRestoreVersion = (version: WikiPageVersion) => {
      // Update the page body with the version's body
      updatePage(activePage.id, { body: version.body, title: version.title }).then(async () => {
        const fresh = await fetchPage(activePage.id)
        if (fresh) setActivePage(fresh)
      })
    }

    setInspector(
      <WikiPageInspector
        page={activePage}
        // Mobile: close just hides the info sheet (keeps the editor open).
        // Desktop: close navigates back to the page list (unchanged).
        onClose={() => (isMobile ? setShowInfo(false) : updateQuery({ page: null }))}
        onUpdate={handleUpdate}
        onDelete={handleDelete}
        onFetchVersions={fetchVersions}
        onRestoreVersion={handleRestoreVersion}
        allPages={pages}
        milestones={milestones}
        taskLinkedMilestones={taskLinkedMilestonesForActivePage}
      />
    )
  }, [
    activePage,
    isMobile,
    showInfo,
    setInspector,
    updatePage,
    deletePage,
    fetchPage,
    fetchVersions,
    updateQuery,
    pages,
    milestones,
    taskLinkedMilestonesForActivePage,
  ])

  // memo 化した WikiPageRow に渡すため安定参照にする
  const handleSelectPage = useCallback((pageId: string) => {
    updateQuery({ page: pageId })
  }, [updateQuery])

  const handleCreatePage = async (data: { title: string; tags?: string[] }) => {
    const created = await createPage(data)
    updateQuery({ page: created.id })
  }

  const handleEditorChange = useCallback((content: string) => {
    if (!activePage) return

    // Clear existing timers
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current)

    setSaveStatus('saving')

    saveTimerRef.current = setTimeout(async () => {
      try {
        await updatePage(activePage.id, { body: content })
        setSaveStatus('saved')
        savedTimerRef.current = setTimeout(() => setSaveStatus('idle'), 2000)
      } catch {
        setSaveStatus('idle')
      }
    }, 1500)
  }, [activePage, updatePage])

  // Cleanup timers
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    }
  }, [])

  const handleBackToList = () => {
    updateQuery({ page: null })
  }

  // Editor view
  if (selectedPageId && activePage) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        {/* Editor Header */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-gray-100 bg-surface flex-shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={handleBackToList}
              className="p-1.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            >
              <ArrowLeft className="text-lg" />
            </button>
            <h1 className="text-lg font-semibold text-gray-900 truncate">{activePage.title}</h1>
          </div>
          <div className="flex items-center gap-2">
            {saveStatus === 'saving' && (
              <span className="text-xs text-gray-400 flex items-center gap-1">
                <span className={`w-1.5 h-1.5 ${SAVING.dot} rounded-full animate-pulse`} />
                保存中...
              </span>
            )}
            {saveStatus === 'saved' && (
              <span className="text-xs text-green-500">保存済み</span>
            )}
            {/* Mobile: open page-info inspector on demand (desktop shows it alongside) */}
            <button
              type="button"
              onClick={() => setShowInfo(true)}
              className="md:hidden p-1.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              aria-label="ページ情報"
            >
              <Info className="text-lg" />
            </button>
            {/* お知らせベル。ヘッダーの一番右に置く。この目印(data-header-bell)があると、
                AppShell がページ上部に出す「ベルだけの1行」が globals.css の :has() で消える。
                モバイルは AppShell のヘッダーにベルがあるので md 未満では出さない。 */}
            <div data-header-bell className="hidden md:block -my-1">
              <AnnouncementBell />
            </div>
          </div>
        </div>

        {/* Editor */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto py-6 px-4">
            <WikiEditorDynamic
              key={activePage.id}
              initialContent={activePage.body || undefined}
              onChange={handleEditorChange}
              editable={true}
              orgId={orgId}
              spaceId={spaceId}
            />
          </div>
        </div>
      </div>
    )
  }

  // List view
  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-surface flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-sm">
            <BookOpen className="text-gray-500" />
            <span className="font-medium text-gray-900">Wiki</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsCreateSheetOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
          >
            <Plus className="text-base" />
            新規ページ
          </button>
          {/* お知らせベル。ヘッダーの一番右に置く。この目印(data-header-bell)があると、
              AppShell がページ上部に出す「ベルだけの1行」が globals.css の :has() で消える。
              モバイルは AppShell のヘッダーにベルがあるので md 未満では出さない。 */}
          <div data-header-bell className="hidden md:block">
            <AnnouncementBell />
          </div>
        </div>
      </div>

      {/* Toolbar — 検索・タグ・作成者・並べ替え・表示項目（ページが1件以上あるときだけ出す） */}
      {!loading && pages.length > 0 && (
        <WikiListToolbar
          pages={pages}
          filters={filters}
          onFiltersChange={setFilters}
          prefs={prefs}
          onPrefsChange={setPrefs}
          members={members}
          currentUserId={currentUser?.id ?? null}
          totalCount={pages.length}
          filteredCount={displayedPages.length}
          groupedRowCount={groupedRowCount}
        />
      )}

      {/* Page List */}
      <div className="flex-1 overflow-y-auto">
        {loading && pages.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <span className="text-sm text-gray-400">読み込み中...</span>
          </div>
        ) : pages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <BookOpen className="text-4xl text-gray-300 mb-3" />
            <p className="text-gray-500 mb-1">Wikiページがありません</p>
            <p className="text-sm text-gray-400 mb-4">「新規ページ」からページを作成してください</p>

            {/* Template apply CTA — only when both wiki and milestones are empty */}
            {milestonesEmpty === true && (
              effectiveShowPresetApplicator ? (
                <div className="w-full max-w-lg text-left">
                  <PresetApplicator
                    spaceId={spaceId}
                    onApplied={() => {
                      setShowPresetApplicator(false)
                      void fetchPages()
                    }}
                  />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowPresetApplicator(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm text-indigo-ink border border-indigo-200 hover:bg-indigo-50 rounded-lg transition-colors"
                >
                  <Sparkle className="text-base" />
                  テンプレートから作成
                </button>
              )
            )}
          </div>
        ) : displayedPages.length === 0 ? (
          <EmptyState
            icon={<BookOpen />}
            message="該当するページがありません"
            action={
              <button
                type="button"
                onClick={() => setFilters(DEFAULT_WIKI_FILTERS)}
                className="text-sm text-indigo-600 hover:text-indigo-700"
              >
                絞り込みを解除
              </button>
            }
          />
        ) : prefs.view === 'folder' ? (
          <div>
            {flatFolderRows.map(({ page, depth, hasChildren, collapsed }) => (
              <WikiPageRow
                key={page.id}
                page={page}
                isSelected={selectedPageId === page.id}
                onSelect={handleSelectPage}
                columns={prefs.columns}
                getMember={getMember}
                milestones={getPageMilestones(page.id)}
                depth={depth}
                hasChildren={hasChildren}
                collapsed={collapsed}
                onToggleCollapse={handleToggleCollapse}
              />
            ))}
          </div>
        ) : prefs.view === 'milestone' ? (
          <div>
            {milestoneGroups.map(({ milestone, pages: groupPages }) => (
              <div key={milestone?.id ?? 'unassigned'}>
                <div className="text-xs font-medium text-gray-500 bg-gray-50 px-4 py-1.5 sticky top-0">
                  {milestone?.name ?? 'マイルストーン未設定'}
                </div>
                {groupPages.map(page => (
                  <WikiPageRow
                    key={page.id}
                    page={page}
                    isSelected={selectedPageId === page.id}
                    onSelect={handleSelectPage}
                    columns={prefs.columns}
                    getMember={getMember}
                    milestones={getPageMilestones(page.id)}
                    duplicatedInOtherGroups={Math.max(0, getPageMilestones(page.id).length - 1)}
                  />
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div>
            {displayedPages.map(page => (
              <WikiPageRow
                key={page.id}
                page={page}
                isSelected={selectedPageId === page.id}
                onSelect={handleSelectPage}
                columns={prefs.columns}
                getMember={getMember}
                milestones={getPageMilestones(page.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create Sheet */}
      <WikiCreateSheet
        isOpen={isCreateSheetOpen}
        onClose={() => setIsCreateSheetOpen(false)}
        onSubmit={handleCreatePage}
      />
    </div>
  )
}
