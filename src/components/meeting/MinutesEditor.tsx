'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
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
import { filterSuggestionItems, insertOrUpdateBlockForSlashMenu } from '@blocknote/core/extensions'
import { ja as jaLocale } from '@blocknote/core/locales'
import { CheckCircle, Checks, NotePencil } from '@phosphor-icons/react'
import { InsertLinkControl } from '@/components/editor/InsertLinkControl'
import type { AppLinkSelection } from '@/components/editor/AppLinkPicker'
import { buildInsertLinkMenuItems, insertAppLink } from '@/components/editor/appLink'
import { useInAppLinkNavigation } from '@/components/editor/inAppLinkNavigation'
import { buildTaskHref, type AppLinkKind } from '@/lib/navigation/appLinks'
import {
  MEETING_NOTE_TYPE,
  parseMinutesMarkdown,
  serializeMinutesBlocks,
  TASK_MARKER_TYPE,
  TOGGLE_TYPE,
} from '@/lib/minutes/markdown'
import { formatNoteStamp } from '@/lib/minutes/noteStamp'
import { buildTaskLineBlock, findTopLevelAncestor, type TaskLineDraft } from '@/lib/minutes/taskLine'
import { MinutesTaskLinePanel } from './MinutesTaskLinePanel'
import { meetingNoteSpec, toggleListItemSpec } from './minutesBlocks'
import { TaskMarkerActions } from './TaskMarkerActions'
import type { MinutesTaskAction, MinutesTaskState } from '@/lib/minutes/taskActions'
import { detectCheckedTaskIds } from '@/lib/minutes/checkboxCompletion'

/**
 * appendMarkdown の結果。「今は無理だが少し待てばできる」一時的な事情と、
 * 「待っても直らない」恒久的な事情を区別する（MinutesDocumentView 側がここを見て、
 * 一時的なら帯を出さずにやり直し、恒久的なら帯を出す）。
 * - 'applied': 差し込めた。
 * - 'busy': 一時的に差し込めない（タスク化中などの読み取り専用・日本語の変換(IME)中）。
 * - 'failed': 恒久的に差し込めない（Markdown の解析・ブロックの挿入そのものが失敗した）。
 */
export type MinutesEditorAppendResult = 'applied' | 'busy' | 'failed'

/**
 * AI秘書の末尾追記との自動合流（MinutesDocumentView）のための差し込み口。
 * appendMarkdown は Markdown を今の文書の最後のブロックの後ろに挿し込む。本物の
 * BlockNote トランザクションが起きるので、呼び出し側の onChange（＝自動保存）が
 * いつもどおり走る。
 */
export interface MinutesEditorApi {
  appendMarkdown: (markdown: string) => MinutesEditorAppendResult
}

interface MinutesEditorProps {
  /** 保存されている議事録 Markdown。マウント時の初期表示にのみ使う（変更後の再パースはしない） */
  minutesMd: string
  onChange?: (markdown: string) => void
  editable?: boolean
  orgId: string
  spaceId: string
  /** 本文中のリンクで画面を移る前に呼ぶ。待ち時間中の自動保存を確定させて書きかけを落とさない */
  onBeforeNavigate?: () => void | Promise<void>
  /**
   * 差し込み口を親へ渡すコールバック。ref は next/dynamic（MinutesEditorDynamic）越しに
   * 通らないため、関数 props にする。マウント/更新のたびに最新の api を渡し、
   * アンマウント時は null を渡して外す。
   */
  registerApi?: (api: MinutesEditorApi | null) => void
  /**
   * 「タスク作成済み」の印から、その場で完了・決定できるようにする入り口。
   * 省略すると、印はこれまでどおり押すとタスクへ移動するだけになる。
   */
  onResolveTask?: MinutesTaskResolver
}

/**
 * 印から操作するための入り口。読み取り（状態を引く）と実行（完了/決定）を1つにまとめて渡す。
 * 省略すると、印はこれまでどおり「押すとタスクへ移動する」だけになる。
 */
export interface MinutesTaskResolver {
  /** 押したときに読む。見つからなければ null */
  resolve: (taskId: string) => Promise<{ title: string; state: MinutesTaskState } | null>
  /** 完了・決定を実行する */
  run: (taskId: string, action: Exclude<MinutesTaskAction, 'open'>) => Promise<void>
}

interface TaskMarkerChipProps {
  taskId: string
  orgId: string
  spaceId: string
  /**
   * いまの入り口を入れた箱。**ref で渡す**のが要点。
   * BlockNote のエディタとスキーマはマウント時の1回しか作られないので、値を直接
   * 閉じ込めると、あとから「編集不可」に変えても印には届かない（タスク化の処理中でも
   * 完了できてしまう）。ref なら押した時点の値を読める。
   */
  resolverRef?: { current: MinutesTaskResolver | undefined }
}

/** UUID（v1〜v5想定の一般形）の形をしているかどうか。壊れた/意図しない taskId をボタン化しない */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * 議事録に埋め込まれた `<!--task:uuid-->` の見た目。単独でテストできるよう
 * BlockNote の render コールバックから切り出している。content:'none' なので文字は足せない。
 *
 * 押すと**その場で操作できる小さなパネル**が出る（完了にする・決定にする・開く）。
 * 以前は押すとタスクへ移動するだけだった。会議中に「これ終わったね」となったとき、
 * 議事録から離れずに終わらせられるようにする。
 *
 * チェック（`- [x]`）を入れても完了になる（handleCheckboxCompletion）。ただし
 * **外したときは何もしない**（完了の取り消しは事故が痛いのでタスク側で行う）。
 * 完了できないときは理由を出してチェックを戻す。
 *
 * taskId が UUID の形のときだけ押せるようにする（壊れた値をボタン化しない）。
 */
export function TaskMarkerChip({ taskId, orgId, spaceId, resolverRef }: TaskMarkerChipProps) {
  // 押した時点の入り口を読む（テストからは resolverRef を直接渡せる）
  const getResolver = useCallback(() => resolverRef?.current, [resolverRef])
  const router = useRouter()
  const isValidTaskId = UUID_RE.test(taskId)
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<MinutesTaskState | null>(null)
  const [title, setTitle] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const goToTask = useCallback(
    () => router.push(buildTaskHref(orgId, spaceId, encodeURIComponent(taskId))),
    [router, orgId, spaceId, taskId]
  )

  const load = useCallback(async () => {
    const resolver = getResolver()
    if (!resolver) return
    setError(null)
    setState(null)
    try {
      const resolved = await resolver.resolve(taskId)
      if (resolved === null) {
        setError('このタスクは見つかりませんでした（削除された可能性があります）')
        return
      }
      setState(resolved.state)
      setTitle(resolved.title)
    } catch {
      setError('タスクの状態を読み込めませんでした')
    }
  }, [getResolver, taskId])

  const handleOpen = useCallback(() => {
    // 操作の入口が無い場面（読み取り専用・タスク化の処理中など）は、これまでどおり移動するだけ
    if (!getResolver()) {
      goToTask()
      return
    }
    setOpen(true)
    void load()
  }, [getResolver, goToTask, load])

  const handleAction = useCallback(
    async (action: MinutesTaskAction) => {
      if (action === 'open') {
        setOpen(false)
        goToTask()
        return
      }
      const resolver = getResolver()
      if (!resolver) return
      setBusy(true)
      setError(null)
      try {
        await resolver.run(taskId, action)
        // 押したあとの状態を出し直す（「決定にする」の次に「完了にする」が押せるように）
        await load()
      } catch (err) {
        setError(err instanceof Error ? err.message : '操作できませんでした')
      } finally {
        setBusy(false)
      }
    },
    [getResolver, taskId, goToTask, load]
  )

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
    <span contentEditable={false} className="relative inline-block align-middle">
      <span
        // 外側にも付いているが、印そのものにも残す。BlockNote の inline content は
        // content:'none'（文字を足せない）であることが前提で、既存のテストもここを見ている
        contentEditable={false}
        role="button"
        tabIndex={0}
        data-testid="minutes-task-marker-chip"
        title="このタスクを操作する"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={handleOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            handleOpen()
          }
        }}
        className={className}
      >
        <CheckCircle weight="fill" className="text-sm" />
        タスク作成済み
      </span>
      {open && (
        <TaskMarkerActions
          state={state}
          title={title}
          error={error}
          busy={busy}
          onAction={handleAction}
          onClose={() => setOpen(false)}
        />
      )}
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
  slash_menu: {
    ...jaLocale.slash_menu,
    toggle_list: {
      ...jaLocale.slash_menu.toggle_list,
      // 近道（`>` ＋スペース）をメニューの説明にも書く。知らないと使われない
      subtext: '中身を隠しておける。「>」とスペースでも作れる',
    },
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
  // 折りたたみ（`>` ＋スペースでも作れる）
  'toggle_list',
])

function useMinutesSchema(
  orgId: string,
  spaceId: string,
  resolverRef: { current: MinutesTaskResolver | undefined }
) {
  return useMemo(() => {
    const taskMarkerSpec = createReactInlineContentSpec(
      {
        type: TASK_MARKER_TYPE,
        propSchema: { taskId: { default: '' } },
        content: 'none',
      } as const,
      {
        render: (props) => (
          <TaskMarkerChip
            taskId={props.inlineContent.props.taskId}
            orgId={orgId}
            spaceId={spaceId}
            resolverRef={resolverRef}
          />
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
        [TOGGLE_TYPE]: toggleListItemSpec,
        [MEETING_NOTE_TYPE]: meetingNoteSpec,
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
    // resolverRef は依存に入れない（ref の箱は変わらない。中身は押した時点で読む）。
    // 入れるとスキーマを作り直すが、BlockNote はマウント時の1回しか使わないので無駄になる
  }, [orgId, spaceId, resolverRef])
}

/**
 * `memo` で包む: 保存中/保存済みの表示切り替えなど、親（MinutesDocumentView）の
 * 再レンダーのたびに BlockNoteView を描き直さないため。渡す props はすべて
 * プリミティブか安定した参照（onChange は呼び出し側で useCallback 済み）にすること。
 */
function MinutesEditorImpl({
  minutesMd,
  onChange,
  editable = true,
  orgId,
  spaceId,
  onBeforeNavigate,
  registerApi,
  onResolveTask,
}: MinutesEditorProps) {
  const editorContainerRef = useInAppLinkNavigation(onBeforeNavigate)
  /**
   * 開いているリンクの種類と、開いた回数。null なら閉じている。
   * 回数を持つのは、**同じ種類で開き直したとき**にもパネルを作り直して検索欄に
   * カーソルを戻すため（持たないと「/」から呼んでも何も起きないように見える）
   */
  const [linkPicker, setLinkPicker] = useState<{ kind: AppLinkKind; seq: number } | null>(null)
  /** 「タスクにする行」のパネルを開いているか */
  const [taskLineOpen, setTaskLineOpen] = useState(false)
  const openLinkPicker = useCallback((kind: AppLinkKind) => {
    setLinkPicker((prev) => ({ kind, seq: (prev?.seq ?? 0) + 1 }))
  }, [])
  const closeLinkPicker = useCallback(() => setLinkPicker(null), [])
  // 入り口は ref に詰め替えて渡す。エディタとスキーマはマウント時の1回しか作られないので、
  // 値のまま渡すと「あとから編集不可にした」が印に届かない（レビュー指摘）
  const resolverRef = useRef<MinutesTaskResolver | undefined>(onResolveTask)
  resolverRef.current = onResolveTask
  const schema = useMinutesSchema(orgId, spaceId, resolverRef)

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

  /**
   * 今の行を「会議メモ」に変える（空の行なら、その行がそのまま会議メモになる）。
   * 「/」メニューからも、本文の下のボタンからも同じ入口を使う。
   */
  /**
   * 「タスクにする行」を入れる。**いちばん外側の行の後ろ**に入れるのが要点。
   * 折りたたみや箇条書きの中に入ると字下げされ、その行はタスク化の候補に出なくなる
   * （DB 側は行頭の `- [ ]` だけを見るため）。
   */
  const insertTaskLine = useCallback(
    (draft: TaskLineDraft) => {
      const block = buildTaskLineBlock(draft, orgId, spaceId)
      if (!block) return
      const cursorId = editor.getTextCursorPosition()?.block?.id
      const anchor = findTopLevelAncestor(editor.document, cursorId)
      if (!anchor) return
      editor.insertBlocks([block] as never, anchor as never, 'after')
      setTaskLineOpen(false)
      editor.focus()
    },
    [editor, orgId, spaceId]
  )

  const insertMeetingNote = useCallback(() => {
    // 書いた日時をその場で焼き付ける。あとから本文を直しても日時は動かない
    insertOrUpdateBlockForSlashMenu(editor, {
      type: MEETING_NOTE_TYPE,
      props: { createdAt: formatNoteStamp() },
    })
    editor.focus()
  }, [editor])

  const getSlashMenuItems = useCallback(
    async (query: string) =>
      filterSuggestionItems(
        [
          {
            key: 'insert_task_line',
            title: 'タスクにする行',
            subtext: 'やること・期限・資料を選ぶと、タスク化できる形で1行入る',
            aliases: ['task', 'todo', 'タスク', 'やること', '決めること', '期限'],
            group: jaLocale.slash_menu.paragraph.group,
            icon: <Checks size={18} />,
            onItemClick: () => setTaskLineOpen(true),
          },
          {
            key: 'insert_meeting_note',
            title: '会議メモ',
            subtext: '会議中に足した補足として、背景に色を付けて残す',
            aliases: ['note', 'memo', 'メモ', '会議メモ', 'かいぎめも', 'コメント'],
            // 既定のブロックと同じ並びに置く（辞書から取って表記を揃える）
            group: jaLocale.slash_menu.paragraph.group,
            icon: <NotePencil size={18} />,
            onItemClick: insertMeetingNote,
          },
          // 「/」からもリンクを差し込めるようにする。押すと本文の下のパネルが開く
          ...buildInsertLinkMenuItems(openLinkPicker),
          // 画面用の項目の型は key を省いているが、中身は既定の項目を広げたものなので key が残っている
          ...getDefaultReactSlashMenuItems(editor).filter((item) =>
            ALLOWED_SLASH_MENU_ITEMS.has((item as { key?: string }).key ?? '')
          ),
        ],
        query
      ),
    [editor, openLinkPicker, insertMeetingNote]
  )

  /**
   * カーソル位置にアプリの中へのリンクを差し込む。
   * 社内のみのファイルのときだけ、「相手先には開けない」という注意を読んでもらうため
   * パネルを開いたままにする（以前は**ファイル全部**で開いたままになっていた）。
   * 閉じるときは本文にカーソルを戻して、そのまま書き続けられるようにする
   */
  const handleSelectLink = useCallback(
    ({ link, keepOpen }: AppLinkSelection) => {
      insertAppLink(editor, link)
      if (keepOpen) return
      setLinkPicker(null)
      editor.focus()
    },
    [editor]
  )

  /**
   * AI秘書の末尾追記との自動合流用。Markdown を今の文書の最後のブロックの後ろに
   * insertBlocks で挿す。ここで本物の BlockNote トランザクションが起きるので、
   * 下の onChange がいつもどおり呼ばれ、呼び出し側の自動保存がそのまま走る
   * （合流のために保存を別立てで組み立てる必要が無い）。
   *
   * 'busy'（一時的）と 'failed'（恒久的）を区別する:
   * - 議事録の形式が壊れていて読み取り専用に倒している最中（parseFailedRef）は、
   *   待っても直らないので 'failed'。
   * - それ以外の読み取り専用（タスク化中などの forceReadOnly・canEdit=false）は、
   *   少し待てば編集可能に戻るので 'busy'。
   * - 日本語などの変換(IME)の途中でトランザクションを起こすと、ブラウザによっては
   *   変換が強制的に打ち切られることがある。会議中は日本語を打ち続ける画面なので、
   *   ここも「今は無理だが少し待てばできる」一時的な 'busy' として扱う。
   */
  const appendMarkdown = useCallback(
    (markdown: string): MinutesEditorAppendResult => {
      if (parseFailedRef.current) return 'failed'
      if (!effectiveEditable) return 'busy'
      if (editor.prosemirrorView?.composing) return 'busy'
      let blocks: unknown
      try {
        blocks = parseMinutesMarkdown(markdown) as never
      } catch {
        return 'failed'
      }
      try {
        const doc = editor.document
        const lastBlock = doc[doc.length - 1]
        if (!lastBlock) return 'failed'
        editor.insertBlocks(blocks as never, lastBlock, 'after')
        return 'applied'
      } catch {
        return 'failed'
      }
    },
    [editor, effectiveEditable]
  )

  useEffect(() => {
    registerApi?.({ appendMarkdown })
    return () => registerApi?.(null)
  }, [registerApi, appendMarkdown])

  /**
   * 直前の本文。チェックが「入った」瞬間だけを拾うために持つ。
   * 状態(useState)にすると打つたびに描き直すので ref にする。
   */
  const lastMarkdownRef = useRef(minutesMd)

  /**
   * チェックを入れたら、そのタスクを完了にする（タスクが既にある行だけ）。
   * 外したときは何もしない（完了の取り消しは事故が痛いのでタスク側で行う）。
   * 完了できないとき（未決・承認待ち）は理由を出し、**チェックを元に戻す**。
   * 付いたままだと「完了した」と誤解するため。
   */
  const handleCheckboxCompletion = useCallback(
    (markdown: string) => {
      const prev = lastMarkdownRef.current
      lastMarkdownRef.current = markdown
      const resolver = resolverRef.current
      if (!resolver) return

      const taskIds = detectCheckedTaskIds(prev, markdown)
      if (taskIds.length === 0) return

      for (const taskId of taskIds) {
        void resolver.run(taskId, 'complete').catch((err: unknown) => {
          const message = err instanceof Error ? err.message : 'このタスクは完了にできませんでした'
          toast.error(message)
          // チェックを戻す。付いたままだと「完了した」と誤解するため。
          // 画面を離れた後に失敗が返ることがあるので、触れなければ黙って諦める
          try {
            // 字下げした行も拾うので、入れ子まで辿る（トップ階層だけ見ると戻せない）
            editor.forEachBlock((block) => {
              if (block.type !== 'checkListItem') return true
              const hasMarker = (block.content as unknown[] | undefined)?.some(
                (c) =>
                  (c as { type?: string }).type === TASK_MARKER_TYPE &&
                  (c as { props?: { taskId?: string } }).props?.taskId === taskId
              )
              if (!hasMarker) return true
              editor.updateBlock(block, {
                props: { ...(block.props as Record<string, unknown>), checked: false },
              } as Parameters<typeof editor.updateBlock>[1])
              return false
            })
          } catch {
            // エディタが既に外れている等。チェックは戻せないが、理由は上のトーストで伝わる
          }
        })
      }
    },
    [editor]
  )

  return (
    <div className="minutes-editor" data-testid="minutes-editor" ref={editorContainerRef}>
      <BlockNoteView
        editor={editor}
        editable={effectiveEditable}
        onChange={() => {
          const markdown = serializeMinutesBlocks(editor.document)
          handleCheckboxCompletion(markdown)
          onChange?.(markdown)
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
          {/* 会議中に一番よく使うので、「/」を知らなくても押せる場所に出す */}
          <button
            type="button"
            data-testid="minutes-insert-task-line"
            onClick={() => setTaskLineOpen((v) => !v)}
            aria-expanded={taskLineOpen}
            className="inline-flex items-center gap-1 rounded border border-gray-200 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
          >
            <Checks size={14} />
            タスクにする行
          </button>
          <button
            type="button"
            data-testid="minutes-insert-meeting-note"
            onClick={insertMeetingNote}
            className="inline-flex items-center gap-1 rounded border border-gray-200 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
          >
            <NotePencil size={14} />
            会議メモ
          </button>
          <InsertLinkControl
            orgId={orgId}
            spaceId={spaceId}
            openKind={linkPicker?.kind ?? null}
            openSeq={linkPicker?.seq}
            onToggle={() => (linkPicker ? closeLinkPicker() : openLinkPicker('file'))}
            onClose={closeLinkPicker}
            onSelect={handleSelectLink}
          />
        </div>
      )}
      {effectiveEditable && taskLineOpen && (
        <MinutesTaskLinePanel
          orgId={orgId}
          spaceId={spaceId}
          onInsert={insertTaskLine}
          onClose={() => setTaskLineOpen(false)}
        />
      )}
    </div>
  )
}

export const MinutesEditor = memo(MinutesEditorImpl)
