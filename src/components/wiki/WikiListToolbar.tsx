'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { MagnifyingGlass, Columns, Check, List, TreeStructure, Flag } from '@phosphor-icons/react'
import type { WikiPage } from '@/types/database'
import type { SpaceMember } from '@/lib/hooks/useSpaceMembers'
import {
  DEFAULT_WIKI_FILTERS,
  collectWikiTags,
  type WikiListFilters,
  type WikiSortKey,
  type WikiViewMode,
} from '@/lib/wiki/listView'
import type { WikiListColumn, WikiListPrefs } from '@/lib/wiki/listPrefs'

const TAG_CHIP_LIMIT = 8

const VIEW_OPTIONS: { mode: WikiViewMode; label: string; icon: typeof List }[] = [
  { mode: 'list', label: '一覧', icon: List },
  { mode: 'folder', label: 'フォルダ', icon: TreeStructure },
  { mode: 'milestone', label: 'マイルストーン別', icon: Flag },
]

const SORT_OPTIONS: WikiSortKey[] = ['updated_at', 'created_at', 'title', 'author']
const SORT_LABELS: Record<WikiSortKey, string> = {
  updated_at: '更新日',
  created_at: '作成日',
  title: 'タイトル',
  author: '作成者',
}

const COLUMN_OPTIONS: WikiListColumn[] = ['tags', 'milestones', 'author', 'updater', 'created_at', 'updated_at']
const COLUMN_LABELS: Record<WikiListColumn, string> = {
  tags: 'タグ',
  milestones: 'マイルストーン',
  author: '作成者',
  updater: '更新者',
  created_at: '作成日',
  updated_at: '更新日',
}

interface WikiListToolbarProps {
  /** 絞り込み前の全ページ（タグ集計・件数表示に使う） */
  pages: WikiPage[]
  filters: WikiListFilters
  onFiltersChange: (filters: WikiListFilters) => void
  prefs: WikiListPrefs
  onPrefsChange: (prefs: WikiListPrefs) => void
  members: SpaceMember[]
  currentUserId: string | null
  totalCount: number
  filteredCount: number
  /** マイルストーン別表示での延べ行数（1ページが複数グループに出るぶん増える）。他の表示では未使用。 */
  groupedRowCount?: number
}

export function WikiListToolbar({
  pages,
  filters,
  onFiltersChange,
  prefs,
  onPrefsChange,
  members,
  currentUserId,
  totalCount,
  filteredCount,
  groupedRowCount,
}: WikiListToolbarProps) {
  const [tagsExpanded, setTagsExpanded] = useState(false)

  // ドロップダウンの開閉と外側クリック検知（TaskFilterMenu と同じ mousedown の作法。
  // 3つとも同型だが、ref をまとめたオブジェクトを返す共通フックにすると
  // react-hooks/refs (「レンダー中に ref を読むな」) に抵触するため個別に書く）。
  const [isAuthorOpen, setIsAuthorOpen] = useState(false)
  const authorMenuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (authorMenuRef.current && !authorMenuRef.current.contains(event.target as Node)) {
        setIsAuthorOpen(false)
      }
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsAuthorOpen(false)
    }
    if (isAuthorOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleEscape)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isAuthorOpen])

  const [isSortOpen, setIsSortOpen] = useState(false)
  const sortMenuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (sortMenuRef.current && !sortMenuRef.current.contains(event.target as Node)) {
        setIsSortOpen(false)
      }
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsSortOpen(false)
    }
    if (isSortOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleEscape)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isSortOpen])

  const [isColumnsOpen, setIsColumnsOpen] = useState(false)
  const columnsMenuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (columnsMenuRef.current && !columnsMenuRef.current.contains(event.target as Node)) {
        setIsColumnsOpen(false)
      }
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsColumnsOpen(false)
    }
    if (isColumnsOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleEscape)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isColumnsOpen])

  const allTags = useMemo(() => collectWikiTags(pages), [pages])
  const visibleTags = tagsExpanded ? allTags : allTags.slice(0, TAG_CHIP_LIMIT)
  const hiddenTagCount = allTags.length - visibleTags.length

  const isFiltering = filters.query.trim() !== '' || filters.tags.length > 0 || filters.authorIds.length > 0

  const toggleTag = (tag: string) => {
    const nextTags = filters.tags.includes(tag)
      ? filters.tags.filter(t => t !== tag)
      : [...filters.tags, tag]
    onFiltersChange({ ...filters, tags: nextTags })
  }

  const toggleAuthor = (userId: string) => {
    const nextAuthors = filters.authorIds.includes(userId)
      ? filters.authorIds.filter(id => id !== userId)
      : [...filters.authorIds, userId]
    onFiltersChange({ ...filters, authorIds: nextAuthors })
  }

  const isOnlyMe = currentUserId != null && filters.authorIds.length === 1 && filters.authorIds[0] === currentUserId

  const toggleOnlyMe = () => {
    if (!currentUserId) return
    onFiltersChange({ ...filters, authorIds: isOnlyMe ? [] : [currentUserId] })
  }

  const selectSortKey = (key: WikiSortKey) => {
    const nextDir = prefs.sort.key === key && prefs.sort.dir === 'desc' ? 'asc' : 'desc'
    onPrefsChange({ ...prefs, sort: { key, dir: nextDir } })
    setIsSortOpen(false)
  }

  const toggleColumn = (column: WikiListColumn) => {
    const nextColumns = prefs.columns.includes(column)
      ? prefs.columns.filter(c => c !== column)
      : [...prefs.columns, column]
    onPrefsChange({ ...prefs, columns: nextColumns })
  }

  const clearFilters = () => {
    onFiltersChange(DEFAULT_WIKI_FILTERS)
  }

  return (
    <div className="border-b border-gray-100 bg-surface flex-shrink-0">
      {/* 1行目: 検索・タグ・作成者・並べ替え・表示項目。
          外側に overflow-x を付けると overflow-y も auto に計算されて下に開くメニューが切れるため、
          横スクロールはタグチップの帯だけに限定する */}
      <div className="flex items-center gap-2 px-4 py-2">
        <div className="flex items-center flex-shrink-0 border border-gray-200 rounded-lg overflow-hidden">
          {VIEW_OPTIONS.map(({ mode, label, icon: Icon }) => {
            const selected = prefs.view === mode
            return (
              <button
                key={mode}
                type="button"
                data-testid={`wiki-view-${mode}`}
                aria-pressed={selected}
                aria-label={label}
                title={label}
                onClick={() => onPrefsChange({ ...prefs, view: mode })}
                className={`px-2 py-1.5 transition-colors ${
                  selected ? 'bg-indigo-50 text-indigo-ink' : 'text-gray-500 hover:bg-gray-50'
                }`}
              >
                <Icon className="text-sm" />
              </button>
            )
          })}
        </div>

        <div className="relative flex-shrink-0 w-40 md:w-56">
          <MagnifyingGlass className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none" />
          <input
            type="text"
            data-testid="wiki-search"
            aria-label="タイトル・タグで検索"
            placeholder="タイトル・タグで検索"
            value={filters.query}
            onChange={(e) => onFiltersChange({ ...filters, query: e.target.value })}
            className="w-full pl-7 pr-2 py-1.5 text-sm border border-gray-200 rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
          />
        </div>

        {allTags.length > 0 ? (
          <div className="flex items-center gap-1.5 flex-1 min-w-0 overflow-x-auto" data-testid="wiki-tag-strip">
            {visibleTags.map(({ tag, count }) => {
              const selected = filters.tags.includes(tag)
              return (
                <button
                  key={tag}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => toggleTag(tag)}
                  className={`flex-shrink-0 flex items-center gap-1 px-2 py-1 text-xs rounded-full border transition-colors ${
                    selected
                      ? 'bg-indigo-50 text-indigo-ink border-indigo-200'
                      : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                  }`}
                >
                  <span>{tag}</span>
                  <span className="text-gray-400">{count}</span>
                </button>
              )
            })}
            {!tagsExpanded && hiddenTagCount > 0 && (
              <button
                type="button"
                onClick={() => setTagsExpanded(true)}
                className="flex-shrink-0 px-2 py-1 text-xs text-gray-500 hover:text-gray-700"
              >
                他 {hiddenTagCount} 個
              </button>
            )}
            {tagsExpanded && allTags.length > TAG_CHIP_LIMIT && (
              <button
                type="button"
                onClick={() => setTagsExpanded(false)}
                className="flex-shrink-0 px-2 py-1 text-xs text-gray-500 hover:text-gray-700"
              >
                たたむ
              </button>
            )}
          </div>
        ) : (
          <div className="flex-1 min-w-2" />
        )}

        {currentUserId && (
          <button
            type="button"
            onClick={toggleOnlyMe}
            aria-pressed={isOnlyMe}
            className={`hidden md:inline-flex flex-shrink-0 px-2 py-1.5 text-xs rounded-lg border transition-colors ${
              isOnlyMe
                ? 'bg-indigo-50 text-indigo-ink border-indigo-200'
                : 'text-gray-600 border-gray-200 hover:border-gray-300 bg-surface'
            }`}
          >
            自分のページ
          </button>
        )}

        <div ref={authorMenuRef} className="relative hidden md:block flex-shrink-0">
          <button
            type="button"
            onClick={() => setIsAuthorOpen(o => !o)}
            aria-haspopup="menu"
            aria-expanded={isAuthorOpen}
            className={`flex items-center gap-1 px-2 py-1.5 text-xs rounded-lg border transition-colors ${
              filters.authorIds.length > 0
                ? 'bg-indigo-50 text-indigo-ink border-indigo-200'
                : 'text-gray-600 border-gray-200 hover:border-gray-300 bg-surface'
            }`}
          >
            作成者
            {filters.authorIds.length > 0 && (
              <span className="w-4 h-4 rounded-full bg-indigo-500 text-white text-[10px] flex items-center justify-center">
                {filters.authorIds.length}
              </span>
            )}
          </button>
          {isAuthorOpen && (
            <div
              data-testid="wiki-author-menu"
              className="absolute top-full right-0 mt-1 z-50 bg-surface rounded-lg shadow-lg border border-gray-200 min-w-[180px] max-h-[300px] overflow-y-auto py-1"
            >
              {members.map(member => (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => toggleAuthor(member.id)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 transition-colors"
                >
                  <span
                    className={`w-4 h-4 rounded border flex items-center justify-center ${
                      filters.authorIds.includes(member.id)
                        ? 'bg-indigo-500 border-indigo-500 text-white'
                        : 'border-gray-300'
                    }`}
                  >
                    {filters.authorIds.includes(member.id) && <Check weight="bold" className="text-xs" />}
                  </span>
                  <span>{member.displayName}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div ref={sortMenuRef} className="relative flex-shrink-0">
          <button
            type="button"
            onClick={() => setIsSortOpen(o => !o)}
            aria-haspopup="menu"
            aria-expanded={isSortOpen}
            aria-label={`並べ替え: ${SORT_LABELS[prefs.sort.key]} ${prefs.sort.dir === 'asc' ? '昇順' : '降順'}`}
            data-testid="wiki-sort-toggle"
            className="flex items-center gap-1 px-2 py-1.5 text-xs rounded-lg border border-gray-200 hover:border-gray-300 bg-surface text-gray-600 transition-colors"
          >
            {SORT_LABELS[prefs.sort.key]} {prefs.sort.dir === 'asc' ? '↑' : '↓'}
          </button>
          {isSortOpen && (
            <div
              data-testid="wiki-sort-menu"
              className="absolute top-full right-0 mt-1 z-50 bg-surface rounded-lg shadow-lg border border-gray-200 min-w-[140px] py-1"
            >
              {SORT_OPTIONS.map(key => (
                <button
                  key={key}
                  type="button"
                  onClick={() => selectSortKey(key)}
                  className={`w-full flex items-center justify-between px-3 py-1.5 text-sm hover:bg-gray-50 transition-colors ${
                    prefs.sort.key === key ? 'text-indigo-ink' : 'text-gray-700'
                  }`}
                >
                  <span>{SORT_LABELS[key]}</span>
                  {prefs.sort.key === key && <span>{prefs.sort.dir === 'asc' ? '↑' : '↓'}</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        <div ref={columnsMenuRef} className="relative flex-shrink-0">
          <button
            type="button"
            onClick={() => setIsColumnsOpen(o => !o)}
            aria-haspopup="menu"
            aria-expanded={isColumnsOpen}
            aria-label="表示項目"
            data-testid="wiki-columns-toggle"
            className="flex items-center px-2 py-1.5 text-xs rounded-lg border border-gray-200 hover:border-gray-300 bg-surface text-gray-600 transition-colors"
          >
            <Columns className="text-sm" />
          </button>
          {isColumnsOpen && (
            <div
              data-testid="wiki-columns-menu"
              className="absolute top-full right-0 mt-1 z-50 bg-surface rounded-lg shadow-lg border border-gray-200 min-w-[160px] py-1"
            >
              {COLUMN_OPTIONS.map(column => (
                <button
                  key={column}
                  type="button"
                  onClick={() => toggleColumn(column)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 transition-colors"
                >
                  <span
                    className={`w-4 h-4 rounded border flex items-center justify-center ${
                      prefs.columns.includes(column) ? 'bg-indigo-500 border-indigo-500 text-white' : 'border-gray-300'
                    }`}
                  >
                    {prefs.columns.includes(column) && <Check weight="bold" className="text-xs" />}
                  </span>
                  <span>{COLUMN_LABELS[column]}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 2行目: 件数。マイルストーン別表示だけ「延べ」件数を併記する（1ページが複数グループに出るため）。 */}
      <div className="flex items-center gap-2 px-4 pb-2 text-xs text-gray-400">
        {isFiltering ? (
          <>
            <span>
              全 {totalCount} 件中 {filteredCount} 件
              {prefs.view === 'milestone' && groupedRowCount != null && `（延べ ${groupedRowCount} 件）`}
            </span>
            <button type="button" onClick={clearFilters} className="text-indigo-600 hover:text-indigo-ink">
              絞り込みを解除
            </button>
          </>
        ) : (
          <span>
            {totalCount} 件
            {prefs.view === 'milestone' && groupedRowCount != null && `（延べ ${groupedRowCount} 件）`}
          </span>
        )}
      </div>
    </div>
  )
}
