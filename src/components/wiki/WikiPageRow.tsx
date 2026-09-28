'use client'

import { memo, useCallback, useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import Image from 'next/image'
import { CaretDown, CaretRight, DotsThree, Flag, Folder, FolderOpen, PushPin, Tag } from '@phosphor-icons/react'
import { TruncatedText } from '@/components/shared'
import type { Milestone, WikiPage } from '@/types/database'
import { decisionChipLabel, type DecisionCount } from '@/lib/wiki/decisionCounts'
import type { WikiListColumn } from '@/lib/wiki/listPrefs'
import { formatWikiAbsoluteTime, formatWikiRelativeTime, formatWikiShortDate } from '@/lib/wiki/listView'

export interface WikiRowMember {
  name: string
  avatarUrl: string | null
}

interface WikiPageRowProps {
  page: WikiPage
  isSelected: boolean
  /** 行クリック。id 引数の安定コールバックを渡す（memo が効くように毎回新しい関数を作らない）。 */
  onSelect: (pageId: string) => void
  /** メタ行に出す項目。'updated_at' は右端固定位置に出る。 */
  columns: WikiListColumn[]
  getMember: (userId: string) => WikiRowMember | null
  /** このページの所属マイルストーン（PR4 の union: 手動選択＋タスク参照）。columns に 'milestones' が無ければ未使用。 */
  milestones?: Milestone[]
  /**
   * マイルストーン別表示のときだけ渡す。この行が他にいくつのグループにも出ているか
   * （0 なら「他のマイルストーンにも」は出さない）。渡された時点でマイルストーン別表示と
   * みなし、milestones のチップは出さない（そのグループの見出しで所属が自明なため）。
   */
  duplicatedInOtherGroups?: number
  /**
   * このページに紐づく「決定事項のタスク」の数（確定した数 / 全体）。省略または total=0 なら印を出さない。
   * 確定の単位はページではなく決定1件なので、ページ自身に状態は持たせない。
   */
  decisionCount?: DecisionCount
  /** フォルダ表示のインデント深さ。省略時は 0（インデント無し・一覧/マイルストーン表示）。 */
  depth?: number
  /**
   * フォルダ表示で子ページを持つか。省略時はトグル領域自体を出さない
   * （一覧/マイルストーン表示ではフォルダの概念が無いため）。
   */
  hasChildren?: boolean
  collapsed?: boolean
  /** トグルクリック時。行選択には伝播させない。 */
  onToggleCollapse?: (pageId: string) => void

  /**
   * フォルダ扱いか（is_folder または子ページを持つ）。true ならタイトル左に
   * フォルダのアイコンを出す（PR5）。省略時は false（アイコンを出さない＝今までどおり）。
   */
  isFolder?: boolean
  /** 編集できる人か。false（既定）だと名前変更・削除メニュー・ドラッグ移動は一切出さない。 */
  canEdit?: boolean
  /** タイトルのダブルクリックでインライン編集を開始し、Enter確定で呼ばれる（PR5）。 */
  onRename?: (pageId: string, title: string) => void
  /**
   * フォルダ行の「…」メニューの「削除」で呼ばれる。isFolder かつ canEdit のときだけ
   * メニュー自体を出す（通常ページの削除は今までどおりページ情報パネルから行う）。
   */
  onRequestDeleteFolder?: (page: WikiPage) => void

  /** フォルダ表示・デスクトップのみ: ドラッグで移動できるか（PR5）。 */
  isDraggable?: boolean
  onDragStartPage?: (pageId: string) => void
  /** ドラッグ中にこの行の上を通過したとき。落とせるかどうかの判定は呼び出し側の責務。 */
  onDragOverPage?: (pageId: string) => void
  onDropPage?: (pageId: string) => void
  onDragEndPage?: () => void
  /** 今ドラッグ中の対象がこの行の上にあるときだけ渡す。落とせる/落とせないの見た目を変える。 */
  dropHighlight?: 'valid' | 'invalid' | null
}

/** 20px 丸アバター。TaskRow の担当者アバターと同じ見た目（画像があれば画像、無ければ頭文字）。 */
function MemberAvatar({ member, fallbackId }: { member: WikiRowMember | null; fallbackId: string }) {
  // メンバー未取得（読み込み中・退会済み）のときは UUID を出さず「?」で埋める
  const initial = member?.name ? member.name.charAt(0).toUpperCase() : '?'
  void fallbackId

  if (member?.avatarUrl) {
    return (
      <Image
        src={member.avatarUrl}
        alt=""
        width={20}
        height={20}
        className="w-5 h-5 rounded-full object-cover flex-shrink-0"
        unoptimized
      />
    )
  }

  return (
    <div
      className="flex-shrink-0 w-5 h-5 rounded-full bg-gray-200 text-gray-600 flex items-center justify-center text-[10px] font-medium"
      aria-hidden="true"
    >
      {initial}
    </div>
  )
}

/** メタ行の各項目の間に「·」区切りを挟む。 */
function withSeparators(nodes: ReactNode[]): ReactNode[] {
  return nodes.flatMap((node, index) =>
    index === 0 ? [node] : [<span key={`sep-${index}`} className="text-gray-400">·</span>, node]
  )
}

function WikiPageRowInner({
  page,
  isSelected,
  onSelect,
  columns,
  getMember,
  milestones,
  decisionCount,
  duplicatedInOtherGroups,
  depth,
  hasChildren,
  collapsed,
  onToggleCollapse,
  isFolder,
  canEdit,
  onRename,
  onRequestDeleteFolder,
  isDraggable,
  onDragStartPage,
  onDragOverPage,
  onDropPage,
  onDragEndPage,
  dropHighlight,
}: WikiPageRowProps) {
  const metaItems: ReactNode[] = []
  // duplicatedInOtherGroups が渡されている＝マイルストーン別表示。そのグループの見出しで
  // 所属は自明なので、通常のチップではなく「他のグループにも出ている」印だけを出す。
  const inMilestoneGroupView = duplicatedInOtherGroups !== undefined
  const handleClick = useCallback(() => onSelect(page.id), [onSelect, page.id])
  const handleToggleCollapse = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation()
      onToggleCollapse?.(page.id)
    },
    [onToggleCollapse, page.id]
  )

  // インラインの名前変更（PR5）。ダブルクリック、またはフォルダの「…」メニューの
  // 「名前を変更」で開始する。Enter で確定・Escape/外側クリックで取り消す。
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [editTitle, setEditTitle] = useState(page.title)
  const canRename = !!(canEdit && onRename)

  const startEditingTitle = useCallback(
    (e?: MouseEvent) => {
      if (!canRename) return
      e?.stopPropagation()
      setEditTitle(page.title)
      editDoneRef.current = false
      setIsEditingTitle(true)
    },
    [canRename, page.title]
  )

  // Enter/Escape で終えたあとに blur が続けて来ても、二重に確定・取り消ししない目印
  const editDoneRef = useRef(false)

  const cancelEditingTitle = useCallback(() => {
    editDoneRef.current = true
    setIsEditingTitle(false)
    setEditTitle(page.title)
  }, [page.title])

  const commitEditingTitle = useCallback(() => {
    const trimmed = editTitle.trim()
    if (!trimmed) return // 空の名前では確定しない
    editDoneRef.current = true
    setIsEditingTitle(false)
    if (trimmed !== page.title) onRename?.(page.id, trimmed)
  }, [editTitle, onRename, page.id, page.title])

  // 外をクリックしたら、その時点の名前で確定する（Notion と同じ）。空なら取り消す。
  const handleTitleBlur = useCallback(() => {
    if (editDoneRef.current) return
    if (editTitle.trim()) commitEditingTitle()
    else cancelEditingTitle()
  }, [editTitle, commitEditingTitle, cancelEditingTitle])

  const handleTitleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      e.stopPropagation()
      if (e.key === 'Enter') commitEditingTitle()
      if (e.key === 'Escape') cancelEditingTitle()
    },
    [commitEditingTitle, cancelEditingTitle]
  )

  // フォルダの「…」メニュー（名前を変更・削除）。TaskFilterMenu と同じ mousedown の作法。
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!isMenuOpen) return
    function handleClickOutside(event: globalThis.MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setIsMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isMenuOpen])

  const toggleMenu = useCallback((e: MouseEvent) => {
    e.stopPropagation()
    setIsMenuOpen(o => !o)
  }, [])

  const handleMenuRename = useCallback(
    (e: MouseEvent) => {
      setIsMenuOpen(false)
      startEditingTitle(e)
    },
    [startEditingTitle]
  )

  const handleMenuDelete = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation()
      setIsMenuOpen(false)
      onRequestDeleteFolder?.(page)
    },
    [onRequestDeleteFolder, page]
  )

  const showFolderMenu = !!(isFolder && canEdit && onRequestDeleteFolder)

  // ドラッグ移動（PR5・フォルダ表示のデスクトップのみ。呼び出し側が isDraggable で絞る）
  const handleDragStart = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.dataTransfer.effectAllowed = 'move'
      onDragStartPage?.(page.id)
    },
    [onDragStartPage, page.id]
  )
  const handleDragOver = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      if (!isDraggable) return
      e.preventDefault()
      onDragOverPage?.(page.id)
    },
    [isDraggable, onDragOverPage, page.id]
  )
  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      if (!isDraggable) return
      e.preventDefault()
      onDropPage?.(page.id)
    },
    [isDraggable, onDropPage, page.id]
  )
  const handleDragEnd = useCallback(() => onDragEndPage?.(), [onDragEndPage])

  // 「確定 2/5」。決定事項のタスクが1件も無いページには出さない（検討資料・議事メモに
  // 「検討中」を貼ると印の意味が薄れる）。列の表示設定には載せない — 確定の見分けは
  // 常に要るものなので、消せる項目にしない。
  const decisionChip = decisionChipLabel(decisionCount)
  if (decisionChip) {
    metaItems.push(
      <span
        key="decisions"
        data-testid="wiki-decision-chip"
        title={decisionChip.complete ? 'このページの決めることは全部決まっています' : '決めることが残っています'}
        className={
          'px-1.5 py-0.5 text-[10px] font-medium rounded ' +
          (decisionChip.complete
            ? 'bg-indigo-600 text-white'
            : 'border border-indigo-200 text-indigo-ink')
        }
      >
        {decisionChip.text}
      </span>
    )
  }

  if (columns.includes('tags') && page.tags.length > 0) {
    metaItems.push(
      <span key="tags" className="flex items-center gap-1">
        <Tag className="text-gray-400 text-xs" />
        {page.tags.slice(0, 3).map(tag => (
          <span key={tag} className="px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-600 rounded">
            {tag}
          </span>
        ))}
        {page.tags.length > 3 && (
          <span className="text-[10px] text-gray-400">+{page.tags.length - 3}</span>
        )}
      </span>
    )
  }

  if (columns.includes('milestones') && !inMilestoneGroupView && milestones && milestones.length > 0) {
    metaItems.push(
      <span
        key="milestones"
        className="flex items-center gap-1 min-w-0"
        aria-label={`所属マイルストーン: ${milestones.map(m => m.name).join('、')}`}
      >
        <Flag className="text-indigo-400 text-xs flex-shrink-0" aria-hidden="true" />
        {milestones.slice(0, 2).map(m => (
          <span
            key={m.id}
            className="px-1.5 py-0.5 text-[10px] font-medium bg-indigo-50 text-indigo-ink rounded max-w-[8rem] truncate"
          >
            {m.name}
          </span>
        ))}
        {milestones.length > 2 && (
          <span
            className="text-[10px] text-gray-400 flex-shrink-0"
            title={milestones.slice(2).map(m => m.name).join('、')}
          >
            +{milestones.length - 2}
          </span>
        )}
      </span>
    )
  }

  if (inMilestoneGroupView && (duplicatedInOtherGroups ?? 0) > 0) {
    metaItems.push(
      <span key="duplicated-milestones" className="text-[10px] text-gray-400">
        他 {duplicatedInOtherGroups} 件のマイルストーンにも
      </span>
    )
  }

  if (columns.includes('author')) {
    const author = getMember(page.created_by)
    metaItems.push(
      <span key="author" className="flex items-center gap-1.5">
        <MemberAvatar member={author} fallbackId={page.created_by} />
        {author?.name && <span>{author.name}</span>}
      </span>
    )
  }

  if (columns.includes('updater') && page.updated_by !== page.created_by) {
    const updater = getMember(page.updated_by)
    if (updater?.name) {
      metaItems.push(<span key="updater">更新: {updater.name}</span>)
    }
  }

  if (columns.includes('created_at')) {
    metaItems.push(
      <span key="created_at" title={formatWikiAbsoluteTime(page.created_at)}>
        作成 {formatWikiShortDate(page.created_at)}
      </span>
    )
  }

  const showOpenFolder = !!isFolder && hasChildren === true && collapsed === false

  return (
    <div
      onClick={handleClick}
      // 実ブラウザでの確認・E2E から行を押せるようにする目印（日程調整の行 proposal-row-* と同じ作法）
      data-testid={`wiki-page-row-${page.id}`}
      style={{ paddingLeft: 16 + (depth ?? 0) * 20 }}
      draggable={isDraggable || undefined}
      onDragStart={isDraggable ? handleDragStart : undefined}
      onDragOver={isDraggable ? handleDragOver : undefined}
      onDrop={isDraggable ? handleDrop : undefined}
      onDragEnd={isDraggable ? handleDragEnd : undefined}
      className={`flex items-center gap-3 pr-4 py-3 transition-all border-b border-gray-100 last:border-b-0 ${
        dropHighlight === 'valid'
          ? 'border-2 border-dashed border-indigo-400 bg-indigo-50/60'
          : dropHighlight === 'invalid'
            ? 'cursor-not-allowed opacity-60'
            : isSelected
              ? 'cursor-pointer bg-indigo-50/60 border-l-2 border-l-indigo-500'
              : 'cursor-pointer hover:bg-gray-50/80 border-l-2 border-l-transparent'
      }`}
    >
      {/* フォルダ表示のみトグル領域を出す（hasChildren が指定されているときだけ）。
          子が無い行も同幅の空スペースを置き、兄弟行のタイトル位置を揃える。 */}
      {hasChildren !== undefined && (
        <div className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
          {hasChildren && (
            <button
              type="button"
              onClick={handleToggleCollapse}
              aria-label={collapsed ? '展開' : '折りたたむ'}
          aria-expanded={!collapsed}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              {collapsed ? <CaretRight className="text-xs" /> : <CaretDown className="text-xs" />}
            </button>
          )}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          {page.pinned_at != null && (
            <PushPin
              data-testid="wiki-pin-icon"
              weight="fill"
              className="text-gray-400 text-xs flex-shrink-0"
              aria-hidden="true"
            />
          )}
          {isFolder &&
            (showOpenFolder ? (
              <FolderOpen
                data-testid="wiki-folder-icon"
                data-open="true"
                weight="fill"
                className="text-indigo-400 text-sm flex-shrink-0"
                aria-hidden="true"
              />
            ) : (
              <Folder
                data-testid="wiki-folder-icon"
                data-open="false"
                weight="fill"
                className="text-indigo-400 text-sm flex-shrink-0"
                aria-hidden="true"
              />
            ))}
          {isEditingTitle ? (
            <input
              type="text"
              value={editTitle}
              onChange={e => setEditTitle(e.target.value)}
              onKeyDown={handleTitleKeyDown}
              onClick={e => e.stopPropagation()}
              onBlur={handleTitleBlur}
              autoFocus
              className="flex-1 min-w-0 px-1.5 py-0.5 text-sm border border-indigo-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          ) : (
            <span onDoubleClick={canRename ? startEditingTitle : undefined} className="flex-1 min-w-0">
              <TruncatedText as="h3" className={`text-sm font-medium ${isSelected ? 'text-indigo-900' : 'text-gray-900'}`}>
                {page.title}
              </TruncatedText>
            </span>
          )}
          {showFolderMenu && !isEditingTitle && (
            <div ref={menuRef} className="relative flex-shrink-0 ml-auto">
              <button
                type="button"
                onClick={toggleMenu}
                aria-label="フォルダの操作"
                aria-haspopup="menu"
                aria-expanded={isMenuOpen}
                className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              >
                <DotsThree weight="bold" className="text-sm" />
              </button>
              {isMenuOpen && (
                <div
                  data-testid="wiki-folder-menu"
                  onClick={e => e.stopPropagation()}
                  className="absolute top-full right-0 mt-1 z-10 bg-surface rounded-lg shadow-lg border border-gray-200 min-w-[140px] py-1"
                >
                  <button
                    type="button"
                    onClick={handleMenuRename}
                    className="w-full text-left px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    名前を変更
                  </button>
                  <button
                    type="button"
                    onClick={handleMenuDelete}
                    className="w-full text-left px-3 py-1.5 text-sm text-red-600 hover:bg-gray-50 transition-colors"
                  >
                    削除
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        {metaItems.length > 0 && (
          <div className="flex items-center gap-1.5 mt-1 text-xs text-gray-500 min-w-0 overflow-hidden">
            {withSeparators(metaItems)}
          </div>
        )}
      </div>
      {columns.includes('updated_at') && (
        <div
          className="text-xs text-gray-400 flex-shrink-0"
          title={formatWikiAbsoluteTime(page.updated_at)}
        >
          {formatWikiRelativeTime(page.updated_at)}
        </div>
      )}
    </div>
  )
}

/** 検索1文字ごとに全行が作り直されないよう memo 化。props は全て安定参照で渡すこと。 */
export const WikiPageRow = memo(WikiPageRowInner)
