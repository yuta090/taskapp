'use client'

import { useMemo, useState } from 'react'
import { Paperclip, BookOpen, Notebook, Checks } from '@phosphor-icons/react'
import { useFiles, type ProjectFile } from '@/lib/hooks/useFiles'
import { useWikiPages } from '@/lib/hooks/useWikiPages'
import { useMeetings } from '@/lib/hooks/useMeetings'
import { useTasks } from '@/lib/hooks/useTasks'
import { formatFileSize } from '@/lib/files/format'
import { formatTaskNumber } from '@/lib/tasks/taskNumber'
import {
  buildFileDownloadHref,
  buildMinutesHref,
  buildTaskHref,
  buildWikiPageHref,
  type AppLink,
  type AppLinkKind,
} from '@/lib/navigation/appLinks'
import { EditorPickerPanel } from './EditorPickerPanel'
import { PickerOptionList } from './PickerOptionList'

const KINDS: { kind: AppLinkKind; label: string; icon: React.ReactNode }[] = [
  { kind: 'file', label: 'ファイル', icon: <Paperclip /> },
  { kind: 'wiki', label: 'Wiki', icon: <BookOpen /> },
  { kind: 'meeting', label: '議事録', icon: <Notebook /> },
  { kind: 'task', label: 'タスク', icon: <Checks /> },
]

/** 選んだリンクと、そのあとパネルを開いたままにするか */
export interface AppLinkSelection {
  link: AppLink
  /** 相手先に見せないファイルのときだけ true。注意書きを読んでもらうため開いたままにする */
  keepOpen?: boolean
}

interface AppLinkPickerProps {
  orgId: string
  spaceId: string
  /** 選ばれたリンク。呼び出し側がカーソル位置に差し込む */
  onSelect: (selection: AppLinkSelection) => void
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
 * 検索欄とキー操作は `PickerOptionList` が持つ。
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
  const [internalWarning, setInternalWarning] = useState(false)

  const handleKindChange = (next: AppLinkKind) => {
    setKind(next)
    // 前の種別で出した注意書きを残さない（ファイルの話なのに Wiki の一覧に出たままになる）
    setInternalWarning(false)
  }

  const handleSelect = (link: AppLink, keepOpen = false) => {
    setInternalWarning(keepOpen)
    onSelect({ link, keepOpen })
  }

  return (
    <EditorPickerPanel data-testid="app-link-picker" maxHeight={maxHeight}>
      <div className="mb-2 flex items-center gap-0.5 rounded-lg bg-gray-100/80 p-0.5">
        {KINDS.map((entry) => (
          <button
            key={entry.kind}
            type="button"
            aria-pressed={kind === entry.kind}
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
        <p className="mb-2 rounded bg-orange-50 px-2 py-1.5 text-xs text-orange-700" role="status">
          社内のみのファイルです。相手先には開けません
        </p>
      )}

      {kind === 'file' && <FileOptions spaceId={spaceId} onSelect={handleSelect} />}
      {kind === 'wiki' && (
        <WikiOptions
          orgId={orgId}
          spaceId={spaceId}
          onSelect={handleSelect}
          excludePageId={excludeWikiPageId}
        />
      )}
      {kind === 'meeting' && (
        <MeetingOptions orgId={orgId} spaceId={spaceId} onSelect={handleSelect} />
      )}
      {kind === 'task' && <TaskOptions orgId={orgId} spaceId={spaceId} onSelect={handleSelect} />}
    </EditorPickerPanel>
  )
}

type SelectHandler = (link: AppLink, keepOpen?: boolean) => void

function FileOptions({ spaceId, onSelect }: { spaceId: string; onSelect: SelectHandler }) {
  const { data, isLoading } = useFiles(spaceId)
  const files = useMemo(() => (data ?? []).map((f: ProjectFile) => ({ ...f, title: f.name })), [data])

  return (
    <PickerOptionList
      placeholder="ファイルを探す"
      loading={isLoading}
      emptyMessage="ファイルはまだありません。プロジェクトのファイルページからアップロードできます"
      items={files}
      renderOption={(file) => ({
        label: file.name,
        icon: <Paperclip />,
        badge: file.clientVisible ? undefined : '社内のみ',
        meta: formatFileSize(file.sizeBytes),
      })}
      onSelect={(file) =>
        onSelect({ href: buildFileDownloadHref(file.id), label: file.name }, !file.clientVisible)
      }
    />
  )
}

function WikiOptions({
  orgId,
  spaceId,
  onSelect,
  excludePageId,
}: {
  orgId: string
  spaceId: string
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

  return (
    <PickerOptionList
      placeholder="Wikiページを探す"
      loading={loading}
      emptyMessage="Wikiページがありません"
      items={others}
      renderOption={(page) => ({ label: page.title || '（無題）', icon: <BookOpen /> })}
      onSelect={(page) =>
        onSelect({
          href: buildWikiPageHref(orgId, spaceId, page.id),
          label: page.title || '（無題）',
        })
      }
    />
  )
}

function MeetingOptions({
  orgId,
  spaceId,
  onSelect,
}: {
  orgId: string
  spaceId: string
  onSelect: SelectHandler
}) {
  const { meetings, loading } = useMeetings({ orgId, spaceId })

  return (
    <PickerOptionList
      placeholder="議事録を探す"
      loading={loading}
      emptyMessage="会議がありません"
      items={meetings}
      renderOption={(meeting) => ({
        label: meeting.title,
        icon: <Notebook />,
        meta: formatHeldAt(meeting.held_at),
      })}
      onSelect={(meeting) =>
        onSelect({ href: buildMinutesHref(orgId, spaceId, meeting.id), label: meeting.title })
      }
    />
  )
}

function TaskOptions({
  orgId,
  spaceId,
  onSelect,
}: {
  orgId: string
  spaceId: string
  onSelect: SelectHandler
}) {
  const { tasks, loading } = useTasks({ orgId, spaceId })
  // 終わったタスクは参照したい相手として選びにくいので候補から外す
  const open = useMemo(() => tasks.filter((task) => task.status !== 'done'), [tasks])

  return (
    <PickerOptionList
      placeholder="タスクを探す"
      loading={loading}
      emptyMessage="タスクがありません"
      items={open}
      renderOption={(task) => ({ label: taskLabel(task), icon: <Checks /> })}
      onSelect={(task) => onSelect({ href: buildTaskHref(orgId, spaceId, task.id), label: taskLabel(task) })}
    />
  )
}

/** タスクは頭に通し番号（TP-42）を付ける。番号が無いものは名前だけ */
function taskLabel(task: { title: string; short_id?: number | null }): string {
  const number = formatTaskNumber(task.short_id)
  return number ? `${number} ${task.title}` : task.title
}

/** 会議の日付。`toISOString` は日本時間で1日ずれるので使わない */
function formatHeldAt(heldAt: string | null): string | undefined {
  if (!heldAt) return undefined
  const date = new Date(heldAt)
  if (Number.isNaN(date.getTime())) return undefined
  return `${date.getMonth() + 1}/${date.getDate()}`
}
