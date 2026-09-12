'use client'

import { memo, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import '@blocknote/core/fonts/inter.css'
import '@blocknote/mantine/style.css'
import { useCreateBlockNote, createReactInlineContentSpec } from '@blocknote/react'
import { BlockNoteView } from '@blocknote/mantine'
import { BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs, defaultStyleSpecs } from '@blocknote/core'
import { ja as jaLocale } from '@blocknote/core/locales'
import { LinkSimple, FileText, CheckCircle } from '@phosphor-icons/react'
import { WikiFileLinkPicker } from '@/components/wiki/WikiFileLinkPicker'
import { MinutesWikiLinkPicker, type MinutesWikiPageOption } from './MinutesWikiLinkPicker'
import { parseMinutesMarkdown, serializeMinutesBlocks, TASK_MARKER_TYPE } from '@/lib/minutes/markdown'
import type { ProjectFile } from '@/lib/hooks/useFiles'

interface MinutesEditorProps {
  /** 保存されている議事録 Markdown。マウント時の初期表示にのみ使う（変更後の再パースはしない） */
  minutesMd: string
  onChange?: (markdown: string) => void
  editable?: boolean
  orgId: string
  spaceId: string
}

interface TaskMarkerChipProps {
  taskId: string
  orgId: string
  spaceId: string
}

/** UUID（v1〜v5想定の一般形）の形をしているかどうか。壊れた/意図しない taskId をボタン化しない */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * 議事録に埋め込まれた `<!--task:uuid-->` の見た目。単独でテストできるよう
 * BlockNote の render コールバックから切り出している。content:'none' なので
 * 文字は足せず、押すとそのタスクの詳細（`?task=<id>`）へ移動するだけ。
 * taskId が UUID の形のときだけボタンにする（それ以外は見た目だけの静的なチップ）。
 */
export function TaskMarkerChip({ taskId, orgId, spaceId }: TaskMarkerChipProps) {
  const router = useRouter()
  const isValidTaskId = UUID_RE.test(taskId)
  const goToTask = () =>
    router.push(`/${orgId}/project/${spaceId}?task=${encodeURIComponent(taskId)}`)

  const className =
    'inline-flex items-center gap-1 mx-1 px-1.5 py-0.5 rounded text-xs font-medium bg-indigo-50 text-indigo-ink align-middle' +
    (isValidTaskId ? ' cursor-pointer hover:bg-indigo-100' : '')

  if (!isValidTaskId) {
    return (
      <span data-testid="minutes-task-marker-chip" className={className}>
        <CheckCircle weight="fill" className="text-sm" />
        タスク作成済み
      </span>
    )
  }

  return (
    <span
      contentEditable={false}
      role="button"
      tabIndex={0}
      data-testid="minutes-task-marker-chip"
      title="このタスクを開く"
      onClick={goToTask}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          goToTask()
        }
      }}
      className={className}
    >
      <CheckCircle weight="fill" className="text-sm" />
      タスク作成済み
    </span>
  )
}

/**
 * 議事録専用スキーマを作る。Wiki と違い、Markdown が正本の議事録では往復できない
 * 見た目（下線・文字色・背景色・meetingsList ブロック等）を持ち込まない。
 *
 * taskMarker（行末の `<!--task:uuid-->`）はチップ表示のみ・content:'none'（文字を足せない）。
 * orgId/spaceId をクロージャで持たせるため、schema はコンポーネント内で作り直す。
 */
/**
 * BlockNote の日本語辞書（`@blocknote/core/locales` の `ja`）をもとにした議事録用の辞書。
 * スラッシュメニューは無効（`slashMenu={false}`）なので、行の案内から「/」の話を消す:
 * - `emptyDocument`（文書全体が空の唯一のブロックのときだけ出る案内）: 「ここに議事録を書きます」
 * - `default`（フォーカスした空行に出る案内）: 空にする（行ごとに毎回文言が出ると煩わしいため）
 */
const MINUTES_DICTIONARY = {
  ...jaLocale,
  placeholders: {
    ...jaLocale.placeholders,
    default: '',
    emptyDocument: 'ここに議事録を書きます',
  },
}

function useMinutesSchema(orgId: string, spaceId: string) {
  return useMemo(() => {
    const taskMarkerSpec = createReactInlineContentSpec(
      {
        type: TASK_MARKER_TYPE,
        propSchema: { taskId: { default: '' } },
        content: 'none',
      } as const,
      {
        render: (props) => (
          <TaskMarkerChip taskId={props.inlineContent.props.taskId} orgId={orgId} spaceId={spaceId} />
        ),
      }
    )

    return BlockNoteSchema.create({
      blockSpecs: {
        paragraph: defaultBlockSpecs.paragraph,
        heading: defaultBlockSpecs.heading,
        bulletListItem: defaultBlockSpecs.bulletListItem,
        numberedListItem: defaultBlockSpecs.numberedListItem,
        checkListItem: defaultBlockSpecs.checkListItem,
        table: defaultBlockSpecs.table,
        codeBlock: defaultBlockSpecs.codeBlock,
      },
      styleSpecs: {
        bold: defaultStyleSpecs.bold,
        italic: defaultStyleSpecs.italic,
        strike: defaultStyleSpecs.strike,
        code: defaultStyleSpecs.code,
      },
      inlineContentSpecs: {
        text: defaultInlineContentSpecs.text,
        link: defaultInlineContentSpecs.link,
        [TASK_MARKER_TYPE]: taskMarkerSpec,
      },
    })
  }, [orgId, spaceId])
}

/**
 * `memo` で包む: 保存中/保存済みの表示切り替えなど、親（MinutesDocumentView）の
 * 再レンダーのたびに BlockNoteView を描き直さないため。渡す props はすべて
 * プリミティブか安定した参照（onChange は呼び出し側で useCallback 済み）にすること。
 */
function MinutesEditorImpl({ minutesMd, onChange, editable = true, orgId, spaceId }: MinutesEditorProps) {
  const [isFilePickerOpen, setIsFilePickerOpen] = useState(false)
  const [isWikiPickerOpen, setIsWikiPickerOpen] = useState(false)
  const schema = useMinutesSchema(orgId, spaceId)

  // 例外が出ないはずのところへの念のための守り。parseMinutesMarkdown が万一例外を
  // 投げても画面を壊さない: 本文全体を1つの段落の生テキストとして出し、読み取り専用にする
  // （中身を作り変えて保存してしまうと、正本の Markdown を壊しかねないため）。
  const parseFailedRef = useRef(false)

  // 初期表示のみ（マウント時点の minutesMd をパース）。以後の変更は BlockNote 自身の
  // ドキュメントが正本になる。再マウントは呼び出し側が key で制御する。
  const initialContent = useMemo(() => {
    try {
      return parseMinutesMarkdown(minutesMd) as never
    } catch {
      parseFailedRef.current = true
      return [{ type: 'paragraph', content: [{ type: 'text', text: minutesMd, styles: {} }] }] as never
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 初期表示専用。以後の minutesMd 変化では作り直さない
  }, [])

  const effectiveEditable = editable && !parseFailedRef.current

  const editor = useCreateBlockNote({
    schema,
    initialContent,
    dictionary: MINUTES_DICTIONARY,
  })

  const handleSelectFile = (file: ProjectFile) => {
    editor.insertInlineContent([
      { type: 'link', href: `/api/files/${file.id}/download`, content: file.name },
    ] as Parameters<typeof editor.insertInlineContent>[0])
    if (file.clientVisible) {
      setIsFilePickerOpen(false)
    }
  }

  const handleSelectWikiPage = (page: MinutesWikiPageOption) => {
    editor.insertInlineContent([
      { type: 'link', href: `/${orgId}/project/${spaceId}/wiki?page=${page.id}`, content: page.title || '（無題）' },
    ] as Parameters<typeof editor.insertInlineContent>[0])
    setIsWikiPickerOpen(false)
  }

  return (
    <div className="minutes-editor" data-testid="minutes-editor">
      <BlockNoteView
        editor={editor}
        editable={effectiveEditable}
        onChange={() => {
          onChange?.(serializeMinutesBlocks(editor.document))
        }}
        theme="light"
        slashMenu={false}
      />
      {effectiveEditable && (
        <div className="flex items-center gap-2 mt-2 px-1">
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setIsFilePickerOpen((prev) => !prev)
                setIsWikiPickerOpen(false)
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg transition-colors"
            >
              <LinkSimple className="text-sm" />
              ファイルへのリンク
            </button>
            {isFilePickerOpen && (
              <div className="absolute bottom-full left-0 mb-2 z-10">
                <WikiFileLinkPicker spaceId={spaceId} onSelect={handleSelectFile} />
              </div>
            )}
          </div>
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setIsWikiPickerOpen((prev) => !prev)
                setIsFilePickerOpen(false)
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg transition-colors"
            >
              <FileText className="text-sm" />
              Wikiページへのリンク
            </button>
            {isWikiPickerOpen && (
              <div className="absolute bottom-full left-0 mb-2 z-10">
                <MinutesWikiLinkPicker orgId={orgId} spaceId={spaceId} onSelect={handleSelectWikiPage} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export const MinutesEditor = memo(MinutesEditorImpl)
