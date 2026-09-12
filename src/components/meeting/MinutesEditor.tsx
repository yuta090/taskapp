'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import '@blocknote/core/fonts/inter.css'
import '@blocknote/mantine/style.css'
import {
  useCreateBlockNote,
  createReactInlineContentSpec,
  getDefaultReactSlashMenuItems,
  SuggestionMenuController,
} from '@blocknote/react'
import { BlockNoteView } from '@blocknote/mantine'
import { BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs, defaultStyleSpecs } from '@blocknote/core'
import { filterSuggestionItems } from '@blocknote/core/extensions'
import { ja as jaLocale } from '@blocknote/core/locales'
import { LinkSimple, FileText, CheckCircle } from '@phosphor-icons/react'
import { WikiFileLinkPicker } from '@/components/wiki/WikiFileLinkPicker'
import { WikiPageLinkInsertPicker, type WikiPageInsertOption } from '@/components/wiki/WikiPageLinkInsertPicker'
import { parseMinutesMarkdown, serializeMinutesBlocks, TASK_MARKER_TYPE } from '@/lib/minutes/markdown'
import type { ProjectFile } from '@/lib/hooks/useFiles'

/**
 * AI秘書の末尾追記との自動合流（MinutesDocumentView）のための差し込み口。
 * appendMarkdown は Markdown を今の文書の最後のブロックの後ろに挿し込む。本物の
 * BlockNote トランザクションが起きるので、呼び出し側の onChange（＝自動保存）が
 * いつもどおり走る。成功したら true、読み取り専用・解析/挿入に失敗したら false。
 */
export interface MinutesEditorApi {
  appendMarkdown: (markdown: string) => boolean
}

interface MinutesEditorProps {
  /** 保存されている議事録 Markdown。マウント時の初期表示にのみ使う（変更後の再パースはしない） */
  minutesMd: string
  onChange?: (markdown: string) => void
  editable?: boolean
  orgId: string
  spaceId: string
  /**
   * 差し込み口を親へ渡すコールバック。ref は next/dynamic（MinutesEditorDynamic）越しに
   * 通らないため、関数 props にする。マウント/更新のたびに最新の api を渡し、
   * アンマウント時は null を渡して外す。
   */
  registerApi?: (api: MinutesEditorApi | null) => void
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
 * - `emptyDocument`（文書全体が空の唯一のブロックのときだけ出る案内）: 空にする。
 *   呼び出し側(MinutesDocumentView)が本文の外側に同じ趣旨の案内文を1つだけ出すため、
 *   ここで出すと「ここに議事録を書きます」が2回表示されてしまう。
 * - `default`（フォーカスした空行に出る案内）: Wiki と同じ文言。「/」でメニューが開くと伝える
 */
const MINUTES_DICTIONARY = {
  ...jaLocale,
  placeholders: {
    ...jaLocale.placeholders,
    default: '文字を入力、または「/」でメニューを開く',
    emptyDocument: '',
  },
}

/**
 * 「/」メニューに出さない項目。議事録は Markdown が正本で、`serializeMinutesBlocks` が
 * 書き出せないブロックを入れられると保存で消える。スキーマ（`useMinutesSchema`）に
 * 無いブロックの項目は BlockNote がそもそも作らないが、あとでスキーマを広げたときに
 * 素通りしないよう、ここでも同じ線を引いておく。
 */
const ALLOWED_SLASH_MENU_ITEMS = new Set([
  'heading',
  'heading_2',
  'heading_3',
  'heading_4',
  'heading_5',
  'heading_6',
  'bullet_list',
  'numbered_list',
  'check_list',
  'paragraph',
  'table',
  'code_block',
  'emoji',
])

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
function MinutesEditorImpl({ minutesMd, onChange, editable = true, orgId, spaceId, registerApi }: MinutesEditorProps) {
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

  const getSlashMenuItems = useCallback(
    async (query: string) =>
      filterSuggestionItems(
        // 画面用の項目の型は key を省いているが、中身は既定の項目を広げたものなので key が残っている
        getDefaultReactSlashMenuItems(editor).filter((item) =>
          ALLOWED_SLASH_MENU_ITEMS.has((item as { key?: string }).key ?? '')
        ),
        query
      ),
    [editor]
  )

  const handleSelectFile = (file: ProjectFile) => {
    editor.insertInlineContent([
      { type: 'link', href: `/api/files/${file.id}/download`, content: file.name },
    ] as Parameters<typeof editor.insertInlineContent>[0])
    if (file.clientVisible) {
      setIsFilePickerOpen(false)
    }
  }

  const handleSelectWikiPage = (page: WikiPageInsertOption) => {
    editor.insertInlineContent([
      { type: 'link', href: `/${orgId}/project/${spaceId}/wiki?page=${page.id}`, content: page.title || '（無題）' },
    ] as Parameters<typeof editor.insertInlineContent>[0])
    setIsWikiPickerOpen(false)
  }

  /**
   * AI秘書の末尾追記との自動合流用。Markdown を今の文書の最後のブロックの後ろに
   * insertBlocks で挿す。ここで本物の BlockNote トランザクションが起きるので、
   * 下の onChange がいつもどおり呼ばれ、呼び出し側の自動保存がそのまま走る
   * （合流のために保存を別立てで組み立てる必要が無い）。
   */
  const appendMarkdown = useCallback(
    (markdown: string): boolean => {
      if (!effectiveEditable) return false
      try {
        const blocks = parseMinutesMarkdown(markdown) as never
        const doc = editor.document
        const lastBlock = doc[doc.length - 1]
        if (!lastBlock) return false
        editor.insertBlocks(blocks, lastBlock, 'after')
        return true
      } catch {
        return false
      }
    },
    [editor, effectiveEditable]
  )

  useEffect(() => {
    registerApi?.({ appendMarkdown })
    return () => registerApi?.(null)
  }, [registerApi, appendMarkdown])

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
      >
        {/* 既定のメニューの代わりに、Markdown で往復できる項目だけに絞ったメニューを置く。
            行の左の「＋」もこのメニューを開くので、これを外すと「＋」も押して何も起きなくなる。
            読み取り専用のときは差し込めないので置かない */}
        {effectiveEditable && (
          <SuggestionMenuController triggerCharacter="/" getItems={getSlashMenuItems} />
        )}
      </BlockNoteView>
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
              // スマホ(md未満)は2つ目のボタンなので left-0 だと右にはみ出す。
              // right-0 にして画面内に収め、デスクトップ(md以上)だけ従来どおり left-0 に戻す。
              <div className="absolute bottom-full right-0 md:right-auto md:left-0 mb-2 z-10">
                <WikiPageLinkInsertPicker orgId={orgId} spaceId={spaceId} onSelect={handleSelectWikiPage} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export const MinutesEditor = memo(MinutesEditorImpl)
