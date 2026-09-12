'use client'

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { BookOpen, Plus, ArrowLeft, Sparkle, Info, ArrowsOut, ArrowsIn } from '@phosphor-icons/react'
import { useInspector, useShellFullscreen } from '@/components/layout'
import { useIsMobile } from '@/lib/hooks/useIsMobile'
import { WikiPageRow, type WikiRowMember } from '@/components/wiki/WikiPageRow'
import { WikiListToolbar } from '@/components/wiki/WikiListToolbar'
import { WikiPageInspector } from '@/components/wiki/WikiPageInspector'
import { WikiCreateSheet } from '@/components/wiki/WikiCreateSheet'
import { WikiEditorDynamic } from '@/components/wiki/WikiEditorDynamic'
import { PresetApplicator } from '@/components/space/PresetApplicator'
import { EmptyState } from '@/components/shared'
import { useWikiPages, WikiConflictError, type UpdateWikiPageInput } from '@/lib/hooks/useWikiPages'
import { useMilestones } from '@/lib/hooks/useMilestones'
import { useSpaceMembers } from '@/lib/hooks/useSpaceMembers'
import { useCurrentUser } from '@/lib/hooks/useCurrentUser'
import { useWikiMilestoneLinks } from '@/lib/hooks/useWikiMilestoneLinks'
import { useCanEditSpace } from '@/lib/hooks/useCanEditSpace'
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

// 議事録の競合帯(MinutesDocumentView.tsx)と同じ文面の作り。Wiki には掲示板のような
// 自動合流・保存の直列化までは作らない（必要最小限）。
const WIKI_CONFLICT_MESSAGE =
  'このページは、ほかの人（またはAI）が先に書き換えました。あなたが書いた分はまだ保存されていません。' +
  '「書きかけをコピー」で控えてから「最新を読み込む」を押してください（読み込むと、この画面の書きかけは消えます。' +
  '控えはそのままでは元の見た目には貼り戻せない形式です）。'

// 「最新を読み込む」で読み直したら、対象のページ自体が既に削除されていた場合の文面。
// 帯は下ろさず（自動保存を止めたまま）、理由だけをこちらに切り替える。
const WIKI_PAGE_DELETED_MESSAGE =
  'このページは見つかりませんでした（削除された可能性があります）。自動保存は止まっています。'

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
  // 全画面表示（デスクトップのみ）。状態は画面の枠（AppShell）が持ち、デスクトップの LeftNav を隠す。
  // 重ね表示（fixed）にしないのは、main の z-0 の中からは LeftNav の上に出られず本文の左端が隠れたため。
  // ページ切り替え・Wikiから離脱で必ずOFFに戻す（戻さないとほかの画面で LeftNav が消えたままになる）。
  const { fullscreen: isFullscreen, setFullscreen: setIsFullscreen } = useShellFullscreen()
  const [isCreateSheetOpen, setIsCreateSheetOpen] = useState(false)
  const [activePage, setActivePage] = useState<WikiPage | null>(null)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null)
  const savedTimerRef = useRef<NodeJS.Timeout | null>(null)
  const [showPresetApplicator, setShowPresetApplicator] = useState(false)

  // 保存の合言葉（楽観ロック）まわり。基準の updated_at と、サーバーにあると分かっている
  // 本文を持つ。開いたとき(fetchPage)と、updatePage が成功した後（属性更新・版の復元を
  // 含むすべての呼び出し）に必ず両方更新する（そうしないと本文保存が偽の競合を出す）。
  const baseUpdatedAtRef = useRef<string | null>(null)
  const knownServerBodyRef = useRef<string | null>(null)
  // 今エディタに表示されている書きかけ（onChange の生値）。「書きかけをコピー」で使う。
  const currentContentRef = useRef<string>('')
  const [conflict, setConflict] = useState(false)
  // conflict(state) と同じ値を常に持つ ref。setConflict は再描画を経てから effect/closure に
  // 反映されるため、その間に発火する古い closure（タイマー・onChange）が「まだ競合していない」
  // と誤判定してしまう（レビュー指摘【高】2）。同期に読めるこちらを判定に使う。
  const conflictRef = useRef(false)
  // 帯を「見つかりません」表示に切り替えるための状態(【中】5)。conflict=true のまま維持し、
  // 文面だけ変える（削除されたページは何度読み直しても null のままなので、帯を下ろさず
  // 安定した終端状態にする＝「毎回帯が出ては消える」を防ぐ）。
  const [pageDeleted, setPageDeleted] = useState(false)
  // 本文保存が同時に2本走らないようにする(【中】4)。通信中に来た保存要求は
  // pendingSaveRequestedRef に印だけ立て、通信が終わってから最新の内容でもう一度だけ送る。
  const savingRef = useRef(false)
  const pendingSaveRequestedRef = useRef(false)
  // 「最新を読み込む」で1つ進める。エディタの key に含め、再マウントさせて
  // initialContent を読み直させる（本体は onChange の度に作り直さない）。ページを
  // 切り替えても 0 に戻さない（【高】3）: activePage.id が変わればどのみち key は変わるため
  // リセットは不要で、逆に 0 へ戻すと「まだ前のページ(A)の本文のまま」の瞬間に key が
  // (新ページB.id-0) に変わって A の本文で B のエディタが作り直され、B を開いた直後に
  // A の本文で保存が走ってしまう（開いた直後の別ページに偽の競合帯が出る事故の元）。
  const [editorReloadToken, setEditorReloadToken] = useState(0)

  // 閲覧者（viewer）・相手先には編集操作を出さない。組織の役割は URL の orgId で判定する
  const { canEdit, canEditMoney } = useCanEditSpace(spaceId, orgId)

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
    // 空のWikiの自動作成（ホームページ等）は編集できる人のときだけ行う
  } = useWikiPages({ orgId, spaceId, canEdit })
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
      // Wikiページから離れたら全画面表示も解除する
      setIsFullscreen(false)
      return
    }

    // Clear timers from previous page
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null }
    if (savedTimerRef.current) { clearTimeout(savedTimerRef.current); savedTimerRef.current = null }
    setSaveStatus('idle')
    // ページを切り替えたら競合状態は必ずリセットする（前のページの取り違えを防ぐ）。
    // editorReloadToken はここでは 0 に戻さない（【高】3）— activePage.id が変わればどのみち
    // key は変わるので不要で、むしろ 0 へ戻すと「selectedPageId は新ページ・activePage は
    // まだ前ページ」の一瞬に key が変わって前ページの本文で新ページのエディタが作り直される。
    conflictRef.current = false
    setConflict(false)
    setPageDeleted(false)
    savingRef.current = false
    pendingSaveRequestedRef.current = false

    setShowInfo(false)
    // ページを切り替えたら全画面表示は必ず解除する
    setIsFullscreen(false)

    let cancelled = false
    const load = async () => {
      const page = await fetchPage(selectedPageId)
      if (!cancelled) {
        setActivePage(page) // null if not found — clears stale state
        baseUpdatedAtRef.current = page?.updated_at ?? null
        knownServerBodyRef.current = page?.body ?? null
        currentContentRef.current = page?.body ?? ''
      }
    }
    load()
    return () => { cancelled = true }
  }, [selectedPageId, fetchPage, setInspector, setIsFullscreen])

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
  // Desktop: inspector sits alongside the editor (auto-open), narrow (320px) so the page reads wider.
  // Mobile: inspector is a full-screen sheet, so only open it on demand (showInfo)
  // to avoid it covering the editor the moment a page is opened.
  // Full-size mode (desktop only) closes the inspector; leaving full-size restores it (isFullscreen dep below).
  useEffect(() => {
    if (!activePage || (isMobile && !showInfo) || isFullscreen) {
      setInspector(null)
      return
    }

    const handleUpdate = async (updates: UpdateWikiPageInput) => {
      // 属性更新は当面 baseUpdatedAt を渡さず無条件で上書きする（設計どおり）。
      await updatePage(activePage.id, updates)
      // Re-fetch page for fresh data
      const fresh = await fetchPage(activePage.id)
      if (fresh) {
        setActivePage(fresh)
        // 本文保存の基準もここで必ず差し替える。差し替えないと、この属性更新で
        // 進んだ updated_at を知らないまま次の本文保存が古い基準で送られ、
        // 偽の競合（WikiConflictError）を起こしてしまう。
        baseUpdatedAtRef.current = fresh.updated_at
        knownServerBodyRef.current = fresh.body ?? null
      }
    }

    const handleDelete = async () => {
      await deletePage(activePage.id)
      updateQuery({ page: null })
    }

    const handleRestoreVersion = (version: WikiPageVersion) => {
      const pageId = activePage.id
      // 【高】1: 保留中の本文の自動保存があれば必ず止める。止めないと、この後で基準を
      // 復元後の値に差し替えたあとにその保存が発火し、復元前の古い書きかけが新しい基準で
      // 保存に成功して「版の復元」自体が黙って取り消される。
      if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null }
      if (savedTimerRef.current) { clearTimeout(savedTimerRef.current); savedTimerRef.current = null }

      // 【中】7: 版の復元も基準(baseUpdatedAt)を渡す。復元は人の明示操作なので、競合したら
      // 本文保存と同じ帯にそのまま乗せてよい（見せかけの競合の確認・自動やり直しまでは行わない）。
      const base = baseUpdatedAtRef.current ?? undefined
      updatePage(pageId, { body: version.body, title: version.title }, base)
        .then(async () => {
          const fresh = await fetchPage(pageId)
          if (fresh === null) {
            // 復元しようとした直後にページ自体が無くなっていた（削除された）
            conflictRef.current = true
            setConflict(true)
            setPageDeleted(true)
            return
          }
          setActivePage(fresh)
          baseUpdatedAtRef.current = fresh.updated_at
          knownServerBodyRef.current = fresh.body ?? null
          currentContentRef.current = fresh.body ?? ''
          // エディタも作り直す。作り直さないと画面には戻す前の本文が残り、
          // 次に1文字打った時点でその本文が保存されて復元が取り消されてしまう。
          setEditorReloadToken(t => t + 1)
        })
        .catch((err) => {
          if (err instanceof WikiConflictError) {
            conflictRef.current = true
            setConflict(true)
          }
        })
    }

    setInspector(
      <WikiPageInspector
        page={activePage}
        // Mobile: close just hides the info sheet (keeps the editor open).
        // Desktop: close navigates back to the page list (unchanged).
        onClose={() => (isMobile ? setShowInfo(false) : updateQuery({ page: null }))}
        // 閲覧者（viewer）・相手先には編集操作を渡さない（onUpdate 等が無ければ表示だけになる設計）
        onUpdate={canEdit ? handleUpdate : undefined}
        onDelete={canEdit ? handleDelete : undefined}
        onFetchVersions={fetchVersions}
        onRestoreVersion={canEdit ? handleRestoreVersion : undefined}
        allPages={pages}
        milestones={milestones}
        taskLinkedMilestones={taskLinkedMilestonesForActivePage}
      />,
      { size: 'narrow' }
    )
  }, [
    activePage,
    isMobile,
    showInfo,
    isFullscreen,
    setInspector,
    canEdit,
    updatePage,
    deletePage,
    fetchPage,
    fetchVersions,
    updateQuery,
    pages,
    milestones,
    taskLinkedMilestonesForActivePage,
  ])

  // 全画面表示中はEscで抜ける（IME変換確定やエディタ内のメニュー操作は妨げない）
  useEffect(() => {
    if (!isFullscreen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return
      if (e.key === 'Escape') setIsFullscreen(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isFullscreen, setIsFullscreen])

  const handleToggleFullscreen = useCallback(() => {
    setIsFullscreen(!isFullscreen)
  }, [isFullscreen, setIsFullscreen])

  // Wiki の画面を離れたら全画面を解除する
  useEffect(() => () => setIsFullscreen(false), [setIsFullscreen])

  // memo 化した WikiPageRow に渡すため安定参照にする
  const handleSelectPage = useCallback((pageId: string) => {
    updateQuery({ page: pageId })
  }, [updateQuery])

  const handleCreatePage = async (data: { title: string; tags?: string[] }) => {
    const created = await createPage(data)
    updateQuery({ page: created.id })
  }

  // 本文保存の実体。savingRef で「今まさに通信中」を表し、同時に2本走らないようにする
  // （【中】4）。呼ばれた時点の currentContentRef.current を読む（古い closure の内容では
  // なく、その時点で分かっている最新の書きかけを送る）。見せかけの競合(本文は同じ)は
  // 基準を差し替えて1回だけ内部でやり直す（既存どおり）。終わったら pendingSaveRequestedRef
  // を確かめ、通信中に来た保存要求があれば最新の内容でもう一度だけ送る。
  const performSave = useCallback(async (pageId: string) => {
    if (conflictRef.current) return
    savingRef.current = true
    setSaveStatus('saving')
    const content = currentContentRef.current

    try {
      const base = baseUpdatedAtRef.current ?? undefined
      try {
        const result = await updatePage(pageId, { body: content }, base)
        baseUpdatedAtRef.current = result.updatedAt
        knownServerBodyRef.current = content
        setSaveStatus('saved')
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
        savedTimerRef.current = setTimeout(() => setSaveStatus('idle'), 2000)
        return
      } catch (err) {
        if (!(err instanceof WikiConflictError)) {
          setSaveStatus('idle')
          return
        }
      }

      // WikiConflictError: 0行だった＝基準の updated_at がズレていた。まず見せかけの競合
      // （他の人がタイトル等だけ変え、本文は変わっていない）かどうかを確かめる。
      const fresh = await fetchPage(pageId)
      if (fresh === null) {
        // 【中】5: ページ自体が既に削除されていた（0行の原因は競合とは限らない）
        conflictRef.current = true
        setConflict(true)
        setPageDeleted(true)
        setSaveStatus('idle')
        return
      }
      if (fresh.body !== knownServerBodyRef.current) {
        // 本文が本当に違う（本当の競合）
        conflictRef.current = true
        setConflict(true)
        setSaveStatus('idle')
        return
      }
      // 本文は同じ → 基準だけ差し替えて1回だけ保存をやり直す
      baseUpdatedAtRef.current = fresh.updated_at
      // 【高】2: 読み直している間に競合が確定していないか、送る直前にもう一度確かめる
      if (conflictRef.current) {
        setSaveStatus('idle')
        return
      }
      try {
        const retryResult = await updatePage(pageId, { body: content }, fresh.updated_at)
        baseUpdatedAtRef.current = retryResult.updatedAt
        knownServerBodyRef.current = content
        setSaveStatus('saved')
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
        savedTimerRef.current = setTimeout(() => setSaveStatus('idle'), 2000)
      } catch (retryErr) {
        if (retryErr instanceof WikiConflictError) {
          conflictRef.current = true
          setConflict(true)
        }
        setSaveStatus('idle')
      }
    } finally {
      savingRef.current = false
      if (pendingSaveRequestedRef.current) {
        pendingSaveRequestedRef.current = false
        if (!conflictRef.current) {
          void performSave(pageId)
        }
      }
    }
  }, [updatePage, fetchPage])

  // デバウンスのタイマーが実際に発火したときの入口。通信中なら送らず「要求あり」の印だけ
  // 立てて performSave の finally に任せる（【中】4）。
  const scheduleSave = useCallback((pageId: string) => {
    if (conflictRef.current) return
    if (savingRef.current) {
      pendingSaveRequestedRef.current = true
      return
    }
    void performSave(pageId)
  }, [performSave])

  const handleEditorChange = useCallback((content: string) => {
    if (!activePage) return
    // 「書きかけをコピー」が常に今の内容を返せるよう、保存の成否に関わらず先に控える
    currentContentRef.current = content

    // 競合中は新しい保存を投げない（編集自体は止めない・帯の「最新を読み込む」を待つ）。
    // state(conflict) ではなく ref を見る — setConflict は再描画を経て closure に反映される
    // ため、その間の古い closure から呼ばれた場合に「まだ競合していない」と誤判定する
    // （【高】2）。
    if (conflictRef.current) return

    // 【高】3の土台: 開いたとき（または直前の保存）と同じ内容なら、保存もタイマーも
    // 張らない。BlockNote は初期表示直後に一度 onChange を呼ぶため、これが無いと
    // ページを開くだけで保存が走り、版の履歴が無駄に増える
    // （議事録の baselineRef 比較(MinutesDocumentView.tsx:380-383)と同じ考え方）。
    if (content === knownServerBodyRef.current) {
      if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null }
      return
    }

    // Clear existing timers
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current)

    setSaveStatus('saving')

    const pageId = activePage.id
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null
      scheduleSave(pageId)
    }, 1500)
  }, [activePage, scheduleSave])

  const handleCopyDraft = useCallback(async () => {
    try {
      // 本文はもともと BlockNote の JSON 文字列（WikiEditor の onChange が
      // JSON.stringify(editor.document) を渡す）。読みやすい Markdown 等へ変換すると
      // 貼り戻せなくなるため、変換せずそのままクリップボードへ入れる
      // （帯の文面で「そのままでは貼り戻せない形式」と断っている）。
      await navigator.clipboard.writeText(currentContentRef.current)
      toast.success('書きかけをコピーしました')
    } catch {
      toast.error('コピーできませんでした')
    }
  }, [])

  const handleReloadLatest = useCallback(async () => {
    if (!activePage) return
    // 【高】1: 保留中の（まだ発火していない）自動保存があれば必ず止める。止めないと、
    // この後で基準を最新に差し替えたあとにこのタイマーが発火し、読み込む前の古い
    // 書きかけが新しい基準で保存に成功して相手の最新の内容を黙って上書きしてしまう。
    // （すでに通信中の保存自体は取り消せない。楽観ロックが最後の砦になる）
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null }
    if (savedTimerRef.current) { clearTimeout(savedTimerRef.current); savedTimerRef.current = null }
    pendingSaveRequestedRef.current = false

    const fresh = await fetchPage(activePage.id)
    if (fresh === null) {
      // 【中】5: 読み直した先でページ自体が無くなっていた（削除された）。帯は下ろさず
      // 文面だけ切り替える。conflict はそのまま true のままにする（安定した終端状態にし、
      // 「読み直すたびに帯が出ては消える」を防ぐ）。
      setPageDeleted(true)
      setSaveStatus('idle')
      return
    }
    setActivePage(fresh)
    baseUpdatedAtRef.current = fresh.updated_at
    knownServerBodyRef.current = fresh.body ?? null
    currentContentRef.current = fresh.body ?? ''
    conflictRef.current = false
    setConflict(false)
    setPageDeleted(false)
    setSaveStatus('idle')
    // key に含めてエディタを作り直し、読み直した内容を initialContent として反映する
    setEditorReloadToken(t => t + 1)
  }, [activePage, fetchPage])

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
        {/* Editor Header — 全画面時はページ名＋閉じるボタンだけの簡易バーに切り替える
            （エディタ本体(WikiEditorDynamic)の位置・key はどちらの状態でも変えない = 再マウントしない） */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-gray-100 bg-surface flex-shrink-0">
          <div className="flex items-center gap-3">
            {!isFullscreen && (
              <button
                onClick={handleBackToList}
                className="p-1.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              >
                <ArrowLeft className="text-lg" />
              </button>
            )}
            <h1 className="text-lg font-semibold text-gray-900 truncate">{activePage.title}</h1>
          </div>
          <div className="flex items-center gap-2">
            {/* 保存の状態は全画面でも出す（全画面で書いていても保存されたか分かるように） */}
            {saveStatus === 'saving' && (
              <span className="text-xs text-gray-400 flex items-center gap-1">
                <span className={`w-1.5 h-1.5 ${SAVING.dot} rounded-full animate-pulse`} />
                保存中...
              </span>
            )}
            {saveStatus === 'saved' && (
              <span className="text-xs text-green-500">保存済み</span>
            )}
            {!isFullscreen && (
              <>
                {/* Mobile: open page-info inspector on demand (desktop shows it alongside) */}
                <button
                  type="button"
                  onClick={() => setShowInfo(true)}
                  className="md:hidden p-1.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                  aria-label="ページ情報"
                >
                  <Info className="text-lg" />
                </button>
                {/* 全画面表示（デスクトップのみ）。ユーザー要望・2026-09-12: Wikiページが狭く読みにくいため */}
                <button
                  type="button"
                  onClick={handleToggleFullscreen}
                  aria-pressed={isFullscreen}
                  data-testid="wiki-fullscreen-toggle"
                  className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <ArrowsOut className="text-base" />
                  全画面
                </button>
              </>
            )}
            {isFullscreen && (
              <button
                type="button"
                onClick={handleToggleFullscreen}
                data-testid="wiki-fullscreen-close"
                className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ArrowsIn className="text-base" />
                全画面を閉じる
              </button>
            )}
            {/* お知らせベル。ヘッダーの一番右に置く。この目印(data-header-bell)があると、
                AppShell がページ上部に出す「ベルだけの1行」が globals.css の :has() で消える。
                モバイルは AppShell のヘッダーにベルがあるので md 未満では出さない。
                全画面でも出す（出さないと AppShell の「ベルだけの1行」が現れる）。 */}
            <div data-header-bell className="hidden md:block -my-1">
              <AnnouncementBell />
            </div>
          </div>
        </div>

        {/* 競合の帯（議事録の帯と同じ考え方）。モーダルにはしない。
            pageDeleted のときは文面だけ「見つかりません」に切り替え、「最新を読み込む」は
            出さない（読み直しても null のままなので無意味）。「書きかけをコピー」は
            控えを残せるよう出したままにする。 */}
        {conflict && (
          <div data-testid="wiki-conflict-banner" className="px-6 py-3 bg-orange-50 border-b border-orange-200 flex-shrink-0">
            <p className="text-sm text-orange-ink">{pageDeleted ? WIKI_PAGE_DELETED_MESSAGE : WIKI_CONFLICT_MESSAGE}</p>
            <div className="mt-2 flex items-center gap-3">
              <button
                type="button"
                onClick={() => void handleCopyDraft()}
                className="text-xs font-medium text-orange-ink hover:underline underline"
              >
                書きかけをコピー
              </button>
              {pageDeleted ? (
                <button
                  type="button"
                  onClick={handleBackToList}
                  className="text-xs font-medium text-orange-ink hover:underline underline"
                >
                  一覧へ戻る
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleReloadLatest()}
                  className="text-xs font-medium text-orange-ink hover:underline underline"
                >
                  最新を読み込む
                </button>
              )}
            </div>
          </div>
        )}

        {/* Editor */}
        <div className="flex-1 overflow-y-auto">
          <div className={isFullscreen ? 'max-w-6xl mx-auto py-6 px-4' : 'max-w-4xl mx-auto py-6 px-4'}>
            <WikiEditorDynamic
              key={`${activePage.id}-${editorReloadToken}`}
              initialContent={activePage.body || undefined}
              onChange={handleEditorChange}
              editable={canEdit}
              orgId={orgId}
              spaceId={spaceId}
              currentPageId={activePage.id}
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
          {canEdit && (
            <button
              onClick={() => setIsCreateSheetOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
            >
              <Plus className="text-base" />
              新規ページ
            </button>
          )}
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

            {/* Template apply CTA — only when both wiki and milestones are empty。
                内部で使う rpc_apply_preset_to_space は「space_memberships の行がはっきり
                admin/editor」を求める（canEdit=行が無い社内メンバーも含む、より広い規則）ため、
                代理店設定・ポータル表示設定と同じ canEditMoney で出し分ける */}
            {canEditMoney && milestonesEmpty === true && (
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
        isOpen={canEdit && isCreateSheetOpen}
        onClose={() => setIsCreateSheetOpen(false)}
        onSubmit={handleCreatePage}
      />
    </div>
  )
}
