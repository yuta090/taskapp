'use client'

import { useMemo, useState } from 'react'
import { MagnifyingGlass, Paperclip, BookOpen, Notebook, Checks } from '@phosphor-icons/react'
import { useFiles, type ProjectFile } from '@/lib/hooks/useFiles'
import { useWikiPages } from '@/lib/hooks/useWikiPages'
import { useMeetings } from '@/lib/hooks/useMeetings'
import { useTasks } from '@/lib/hooks/useTasks'
import { formatFileSize } from '@/lib/files/format'
import { formatTaskNumber } from '@/lib/tasks/taskNumber'
// 名前は Wiki 由来だが中身は「名前とタグで絞り込む」だけの汎用の仕組みで、
// ここではファイル・会議・タスクにも同じ絞り込みを使う
import { createWikiPageSearch } from '@/lib/wiki/pageSearch'
import {
  buildFileDownloadHref,
  buildMinutesHref,
  buildTaskHref,
  buildWikiPageHref,
  type AppLink,
  type AppLinkKind,
} from '@/lib/navigation/appLinks'
import { EditorPickerPanel } from './EditorPickerPanel'

/** 候補に出す最大件数。これを超えた分は「ほか N 件」と伝えて、言葉で絞ってもらう */
const MAX_OPTIONS = 8

const KINDS: { kind: AppLinkKind; label: string; icon: React.ReactNode }[] = [
  { kind: 'file', label: 'ファイル', icon: <Paperclip /> },
  { kind: 'wiki', label: 'Wiki', icon: <BookOpen /> },
  { kind: 'meeting', label: '議事録', icon: <Notebook /> },
  { kind: 'task', label: 'タスク', icon: <Checks /> },
]

interface AppLinkPickerProps {
  orgId: string
  spaceId: string
  /** 選ばれたリンク。呼び出し側がカーソル位置に差し込む */
  onSelect: (link: AppLink) => void
  /** 開いたときに選ばれている種別 */
  defaultKind?: AppLinkKind
  /** 画面に入る高さ。呼び出し側が上下の空きを測って渡す */
  maxHeight?: number
  /** 候補から外す Wiki ページ。いま開いているページ自身へのリンクは要らない */
  excludeWikiPageId?: string
}

/**
 * 文書の本文に「アプリの中の物へのリンク」を差し込むピッカー。Wiki と議事録の両方で使う。
 *
 * モーダル禁止の UI ルールに従い、呼び出し側がインラインパネルとして絶対配置する想定。
 * 種別ごとに別のコンポーネントに分けているのは、**選ばれている種別のぶんしか取りに行かない**
 * ため（1つにまとめると、ファイルを貼りたいだけでもタスク全件を取りに行ってしまう）。
 */
export function AppLinkPicker({
  orgId,
  spaceId,
  onSelect,
  defaultKind = 'file',
  maxHeight,
  excludeWikiPageId,
}: AppLinkPickerProps) {
  const [kind, setKind] = useState<AppLinkKind>(defaultKind)
  const [query, setQuery] = useState('')
  const [internalWarning, setInternalWarning] = useState(false)

  const handleKindChange = (next: AppLinkKind) => {
    setKind(next)
    // 前の種別で打った言葉が残っていると、切り替えた先が空振りして「何も無い」ように見える
    setQuery('')
  }

  const handleSelect = (link: AppLink, isInternalOnly = false) => {
    setInternalWarning(isInternalOnly)
    onSelect(link)
  }

  return (
    <EditorPickerPanel
      data-testid="app-link-picker"
      maxHeight={maxHeight}
      // 本文のカーソルを保つ（押した拍子に外れると差し込み先が分からなくなる）。
      // 検索欄は autoFocus で入れるので、この指定があっても打てる
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).tagName !== 'INPUT') e.preventDefault()
      }}
    >
      <div className="mb-2 flex items-center gap-0.5 rounded-lg bg-gray-100/80 p-0.5">
        {KINDS.map((entry) => (
          <button
            key={entry.kind}
            type="button"
            data-testid={`app-link-picker-kind-${entry.kind}`}
            onClick={() => handleKindChange(entry.kind)}
            className={`flex flex-1 items-center justify-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium transition-colors ${
              kind === entry.kind
                ? 'bg-surface text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {entry.icon}
            {entry.label}
          </button>
        ))}
      </div>

      {internalWarning && (
        <p className="mb-2 rounded bg-orange-50 px-2 py-1.5 text-xs text-orange-700">
          社内のみのファイルです。相手先には開けません
        </p>
      )}

      <div className="relative mb-2">
        <MagnifyingGlass className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="名前で探す"
          autoFocus
          data-testid="app-link-picker-input"
          className="w-full rounded-lg border border-gray-200 bg-surface py-1.5 pl-7 pr-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {kind === 'file' && <FileOptions spaceId={spaceId} query={query} onSelect={handleSelect} />}
      {kind === 'wiki' && (
        <WikiOptions
          orgId={orgId}
          spaceId={spaceId}
          query={query}
          onSelect={handleSelect}
          excludePageId={excludeWikiPageId}
        />
      )}
      {kind === 'meeting' && (
        <MeetingOptions orgId={orgId} spaceId={spaceId} query={query} onSelect={handleSelect} />
      )}
      {kind === 'task' && (
        <TaskOptions orgId={orgId} spaceId={spaceId} query={query} onSelect={handleSelect} />
      )}
    </EditorPickerPanel>
  )
}

type SelectHandler = (link: AppLink, isInternalOnly?: boolean) => void

/** 候補の並び。中身が違っても見た目と操作は揃える */
function OptionList({
  loading,
  emptyMessage,
  hiddenCount,
  children,
}: {
  loading: boolean
  emptyMessage: string
  hiddenCount: number
  children: React.ReactNode
}) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children)
  return (
    <>
      {loading ? (
        <p className="px-2 py-3 text-xs text-gray-400">読み込み中...</p>
      ) : !hasChildren ? (
        <p className="px-2 py-3 text-xs text-gray-500">{emptyMessage}</p>
      ) : (
        <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">{children}</ul>
      )}
      {hiddenCount > 0 && (
        <p className="mt-1 border-t border-gray-100 px-2 pt-1.5 text-xs text-gray-400">
          {`ほか ${hiddenCount} 件。言葉を足すと絞り込めます`}
        </p>
      )}
    </>
  )
}

function Option({
  icon,
  label,
  meta,
  badge,
  onClick,
}: {
  icon?: React.ReactNode
  label: string
  meta?: string
  badge?: string
  onClick: () => void
}) {
  return (
    <li>
      <button
        type="button"
        data-testid="app-link-picker-option"
        onClick={onClick}
        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50"
      >
        {icon && <span className="shrink-0 text-gray-400">{icon}</span>}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {badge && (
          <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
            {badge}
          </span>
        )}
        {meta && <span className="shrink-0 text-xs text-gray-400">{meta}</span>}
      </button>
    </li>
  )
}

/** 名前で絞り込んで、上限までと「隠れた件数」を返す */
function useNarrowed<T extends { title: string; tags?: string[] | null }>(items: readonly T[], query: string) {
  const search = useMemo(() => createWikiPageSearch(items), [items])
  const { matches, total } = useMemo(() => search(query, MAX_OPTIONS), [search, query])
  return { matches, hiddenCount: total - matches.length }
}

function FileOptions({
  spaceId,
  query,
  onSelect,
}: {
  spaceId: string
  query: string
  onSelect: SelectHandler
}) {
  const { data, isLoading } = useFiles(spaceId)
  const files = useMemo(() => (data ?? []).map((f: ProjectFile) => ({ ...f, title: f.name })), [data])
  const { matches, hiddenCount } = useNarrowed(files, query)

  return (
    <OptionList
      loading={isLoading}
      emptyMessage="ファイルはまだありません。プロジェクトのファイルページからアップロードできます"
      hiddenCount={hiddenCount}
    >
      {matches.map((file) => (
        <Option
          key={file.id}
          icon={<Paperclip />}
          label={file.name}
          badge={file.clientVisible ? undefined : '社内のみ'}
          meta={formatFileSize(file.sizeBytes)}
          onClick={() =>
            onSelect({ href: buildFileDownloadHref(file.id), label: file.name }, !file.clientVisible)
          }
        />
      ))}
    </OptionList>
  )
}

function WikiOptions({
  orgId,
  spaceId,
  query,
  onSelect,
  excludePageId,
}: {
  orgId: string
  spaceId: string
  query: string
  onSelect: SelectHandler
  excludePageId?: string
}) {
  // canEdit: false — ピッカーを開いただけで既定ページを勝手に作らせない
  const { pages, loading } = useWikiPages({ orgId, spaceId, canEdit: false })
  // いま開いているページ自身へのリンクは要らないので候補から外す
  const others = useMemo(
    () => (excludePageId ? pages.filter((page) => page.id !== excludePageId) : pages),
    [pages, excludePageId]
  )
  const { matches, hiddenCount } = useNarrowed(others, query)

  return (
    <OptionList loading={loading} emptyMessage="Wikiページがありません" hiddenCount={hiddenCount}>
      {matches.map((page) => (
        <Option
          key={page.id}
          icon={<BookOpen />}
          label={page.title || '（無題）'}
          onClick={() =>
            onSelect({
              href: buildWikiPageHref(orgId, spaceId, page.id),
              label: page.title || '（無題）',
            })
          }
        />
      ))}
    </OptionList>
  )
}

function MeetingOptions({
  orgId,
  spaceId,
  query,
  onSelect,
}: {
  orgId: string
  spaceId: string
  query: string
  onSelect: SelectHandler
}) {
  const { meetings, loading } = useMeetings({ orgId, spaceId })
  const { matches, hiddenCount } = useNarrowed(meetings, query)

  return (
    <OptionList loading={loading} emptyMessage="会議がありません" hiddenCount={hiddenCount}>
      {matches.map((meeting) => (
        <Option
          key={meeting.id}
          icon={<Notebook />}
          label={meeting.title}
          meta={formatHeldAt(meeting.held_at)}
          onClick={() =>
            onSelect({ href: buildMinutesHref(orgId, spaceId, meeting.id), label: meeting.title })
          }
        />
      ))}
    </OptionList>
  )
}

function TaskOptions({
  orgId,
  spaceId,
  query,
  onSelect,
}: {
  orgId: string
  spaceId: string
  query: string
  onSelect: SelectHandler
}) {
  const { tasks, loading } = useTasks({ orgId, spaceId })
  // 終わったタスクは参照したい相手として選びにくいので候補から外す
  const open = useMemo(() => tasks.filter((task) => task.status !== 'done'), [tasks])
  const { matches, hiddenCount } = useNarrowed(open, query)

  return (
    <OptionList loading={loading} emptyMessage="タスクがありません" hiddenCount={hiddenCount}>
      {matches.map((task) => {
        const number = formatTaskNumber(task.short_id)
        const label = number ? `${number} ${task.title}` : task.title
        return (
          <Option
            key={task.id}
            icon={<Checks />}
            label={label}
            onClick={() => onSelect({ href: buildTaskHref(orgId, spaceId, task.id), label })}
          />
        )
      })}
    </OptionList>
  )
}

/** 会議の日付。`toISOString` は日本時間で1日ずれるので使わない */
function formatHeldAt(heldAt: string | null): string | undefined {
  if (!heldAt) return undefined
  const date = new Date(heldAt)
  if (Number.isNaN(date.getTime())) return undefined
  return `${date.getMonth() + 1}/${date.getDate()}`
}
