'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
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
import { CheckCircle, Checks, Flag, NotePencil, User } from '@phosphor-icons/react'
import type { Doc as YDoc, XmlFragment as YXmlFragment } from 'yjs'
import type { Awareness } from 'y-protocols/awareness'
import { seedMinutesDoc } from '@/lib/collab/seed'
import { cursorColorAt, cursorFallbackAt } from '@/lib/collab/cursorColors'
import { InsertLinkControl } from '@/components/editor/InsertLinkControl'
import type { AppLinkSelection } from '@/components/editor/AppLinkPicker'
import { buildInsertLinkMenuItems, insertAppLink } from '@/components/editor/appLink'
import { useInAppLinkNavigation } from '@/components/editor/inAppLinkNavigation'
import { buildTaskHref, type AppLinkKind } from '@/lib/navigation/appLinks'
import {
  ASSIGNEE_MARKER_TYPE,
  MEETING_NOTE_TYPE,
  MILESTONE_MARKER_TYPE,
  parseMinutesMarkdown,
  serializeMinutesBlocks,
  TASK_MARKER_TYPE,
  TOGGLE_TYPE,
} from '@/lib/minutes/markdown'
import { formatNoteStamp, normalizeNoteAuthor } from '@/lib/minutes/noteStamp'
import { buildTaskLineBlock, findTopLevelAncestor, type TaskLineDraft } from '@/lib/minutes/taskLine'
/**
 * パネルは押したときだけ読み込む。中で Wiki の取得層（`useWikiPages`）と
 * `WikiPageLinkPicker` をまとめて参照するので、置いておくと議事録を開いただけで
 * 一式が載る（リンクのパネルを遅延読み込みにしているのと同じ理由）。
 */
const MinutesTaskLinePanel = dynamic(
  () => import('./MinutesTaskLinePanel').then((m) => m.MinutesTaskLinePanel),
  {
    ssr: false,
    loading: () => (
      <div className="mt-2 rounded border border-gray-200 bg-surface p-3 text-xs text-gray-400">
        読み込み中...
      </div>
    ),
  }
)
import { meetingNoteSpec, toggleListItemSpec } from './minutesBlocks'
import { MINUTES_DICTIONARY } from './minutesDictionary'
import { TaskMarkerActions } from './TaskMarkerActions'
import type { MinutesTaskAction, MinutesTaskState } from '@/lib/minutes/taskActions'
import { detectCheckedTaskIds } from '@/lib/minutes/checkboxCompletion'
import { completeFailureMessage } from '@/lib/minutes/taskActions'
import { MinutesCompleteError } from '@/lib/hooks/useMinutesTaskActions'
import { useIsDarkTheme } from '@/lib/hooks/useIsDarkTheme'

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
  /**
   * 同時編集の器に、この本文で種をまく。種まきには ProseMirror のスキーマが要り、
   * それを持っているのはこのエディタだけなので、ここから貸す。
   */
  seedCollabDoc: (doc: YDoc, markdown: string) => string
}

/** 同時編集をするときだけ渡す。渡さなければ、これまでどおり1人用のエディタになる */
export interface MinutesEditorCollaboration {
  fragment: YXmlFragment
  awareness: Awareness
  /** カーソルの脇に出す自分の名前 */
  userName: string
  /**
   * 何番の色でカーソルを描くか。部屋の中で重ならないように呼び出し側が決める
   * （人ごとにハッシュで選ぶと、運が悪いと2人が同じ色になる）
   */
  colorIndex: number
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
  /**
   * 会議メモに残す「書いた人」の名前（プロフィールの表示名）。押した時点の値を焼き付ける。
   * メンバー一覧の読み込み中や分からないときは空で、そのときは日時だけが残る。
   */
  noteAuthorName?: string
  /** 同時編集をするときだけ渡す。渡すと本文の正本は器（Y.Doc）側になる */
  collaboration?: MinutesEditorCollaboration
  /**
   * いま相手の更新を取り込んでいる最中か。取り込みもエディタの変更として届くので、
   * これが true の間は「自分が操作した」ことが前提の処理（チェックでタスクを完了に
   * する等）を走らせない。全員の画面で一斉に走ってしまうため。
   */
  isApplyingRemote?: () => boolean
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

interface TaskMetaChipProps {
  kind: 'assignee' | 'milestone'
  name: string
}

/**
 * 担当者・マイルストーンの印を、本文の中で読める形にする。
 *
 * 印そのものは `<!--assignee:uuid 田中-->` という文字で、そのまま出すと本文が読めなくなる。
 * ここでは印に一緒に書いてある名前を出すだけで、問い合わせはしない（名前が古くなっても、
 * できるタスクは印の ID のとおりになる）。名前が消されていても、印があることだけは伝える。
 */
export function TaskMetaChip({ kind, name }: TaskMetaChipProps) {
  const label = name.trim() === '' ? '不明' : name.trim()
  const Icon = kind === 'assignee' ? User : Flag
  return (
    <span
      contentEditable={false}
      data-testid={kind === 'assignee' ? 'minutes-assignee-chip' : 'minutes-milestone-chip'}
      className="inline-flex items-center gap-1 mx-1 px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700 align-middle"
    >
      <Icon weight="fill" className="text-sm" />
      {kind === 'assignee' ? `担当: ${label}` : label}
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

    const taskMetaSpec = (kind: 'assignee' | 'milestone') =>
      createReactInlineContentSpec(
        {
          type: kind === 'assignee' ? ASSIGNEE_MARKER_TYPE : MILESTONE_MARKER_TYPE,
          // id は作るときに使う。name は画面に出すためだけのもの
          propSchema: { id: { default: '' }, name: { default: '' } },
          content: 'none',
        } as const,
        {
          render: (props) => <TaskMetaChip kind={kind} name={props.inlineContent.props.name} />,
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
        [ASSIGNEE_MARKER_TYPE]: taskMetaSpec('assignee'),
        [MILESTONE_MARKER_TYPE]: taskMetaSpec('milestone'),
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
  noteAuthorName,
  collaboration,
  isApplyingRemote,
}: MinutesEditorProps) {
  const editorContainerRef = useInAppLinkNavigation(onBeforeNavigate)
  // 名前はメンバー一覧を読み終えてから届く。値のまま「/」メニューの項目に閉じ込めると、
  // 届いたときに項目の取り方ごと作り直しになる（開いているメニューが取り直しになる）ので、
  // ref に入れて押した時点の値を読む
  const noteAuthorRef = useRef(noteAuthorName)
  noteAuthorRef.current = noteAuthorName
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

  /**
   * BlockNote へ渡す「書いてよいか」は、**載せたときの値のまま動かさない**。
   *
   * BlockNote はこの値が変わると、エディタをいったん外して載せ直す。その拍子に
   * 取り消し（Ctrl+Z / Cmd+Z）の控えを持っている係が片付けられ、載せ直しても
   * 作り直されない（プラグインの持ち物がそのまま引き継がれるため）。結果、
   * **以後ずっと取り消しが効かなくなる**（ユーザー報告・2026-09-17）。
   * 議事録では「本文が届くまで読み取り専用」「タスク化の間だけ読み取り専用」と
   * 何度も変わるので、そのたびに取り消しが死んでいた。
   *
   * 途中の変化は、下の effect が**載せ直さないやり方**で当てる。BlockNote の道具立て
   * （「/」メニュー・行の取っ手・文字の飾り）はどれも `editor.isEditable` を見ているので、
   * 読み取り専用の守りは弱くならない。
   */
  const mountEditableRef = useRef(effectiveEditable)

  /**
   * 同時編集をするときは `initialContent` を渡さない。
   *
   * BlockNote 0.46 は collaboration が付いていると、載せた直後に器（Y.XmlFragment）の
   * 中身で本文を**置き換える**（`initialContent` は警告が出るだけで捨てられる。
   * y-prosemirror の `_forceRerender`）。渡しても消えるだけなので、本文は器へ
   * 種をまく形で入れる（`seedCollabDoc` → `MinutesCollabSession`）。
   */
  // BlockNote は色を CSS でなく props のテーマで受け取るので、真偽値で渡す
  const isDark = useIsDarkTheme()

  const editor = useCreateBlockNote({
    schema,
    ...(collaboration
      ? {
          collaboration: {
            fragment: collaboration.fragment,
            // 載せるときは控えの値で作る（画面を測るのは描画が終わったあと）。
            // 実際の値は下の effect が入れ直す
            user: { name: collaboration.userName, color: cursorFallbackAt(collaboration.colorIndex) },
            provider: { awareness: collaboration.awareness },
          },
        }
      : { initialContent }),
    dictionary: MINUTES_DICTIONARY,
  })

  // 「書いてよいか」の変化は、エディタを載せ直さないこちらの道で当てる（上の注を参照）。
  // **依存の配列はあえて付けない**。万一 BlockNote が器ごと載せ直すと、値は上の
  // 「載せたときの値」に巻き戻る。そのとき依存が同じだと当て直されず、読み取り専用が
  // 黙って外れる。毎回の描画で当てても、BlockNote の入り口が「同じ値なら何もしない」と
  // 守っているので、実質は比較1回で終わる。
  useEffect(() => {
    editor.isEditable = effectiveEditable
  })

  /**
   * 今の行を「会議メモ」に変える（空の行なら、その行がそのまま会議メモになる）。
   * 「/」メニューからも、本文の下のボタンからも同じ入口を使う。
   */
  /**
   * 「タスクにする行」を入れる。**いちばん外側の行の後ろ**に入れるのが要点。
   * 折りたたみや箇条書きの中に入ると字下げされ、その行はタスク化の候補に出なくなる
   * （DB 側は行頭の `- [ ]` だけを見るため）。
   *
   * 入れたあとは**入れた行にカーソルを移す**。入る場所はカーソルのあった行の後ろ＝
   * 画面の上のほうで、パネルは本文のいちばん下に出るので、そのままだと手元では何も
   * 変わらず「入っていない」ように見える（ユーザー報告・2026-09-15）。
   */
  const insertTaskLine = useCallback(
    (draft: TaskLineDraft) => {
      const block = buildTaskLineBlock(draft, orgId, spaceId)
      if (!block) return
      const cursorId = editor.getTextCursorPosition()?.block?.id
      const anchor = findTopLevelAncestor(editor.document, cursorId)
      if (!anchor) return
      const inserted = editor.insertBlocks([block] as never, anchor as never, 'after')
      setTaskLineOpen(false)
      const target = inserted?.[0] as { id?: string } | undefined
      if (target?.id) editor.setTextCursorPosition(target as never, 'end')
      // 先に本文へ戻す。contenteditable に手が戻るとブラウザが勝手に画面を動かすので、
      // **そのあとに**寄せて位置を決める（逆にすると focus 側の位置で終わる）
      editor.focus()
      if (target?.id) {
        // カーソルを置くだけでは画面は動かない（BlockNote は選択を変えるだけ）。
        // 入れた行そのものを画面に入れる
        editorContainerRef.current
          ?.querySelector(`[data-id="${target.id}"]`)
          // jsdom のように scrollIntoView を持たない場合もある（useSpotlightRect と同じ守り）
          ?.scrollIntoView?.({ block: 'nearest' })
      }
    },
    [editor, orgId, spaceId, editorContainerRef]
  )

  const insertMeetingNote = useCallback(() => {
    // 書いた日時と名前をその場で焼き付ける。あとから本文を直しても、別の人が書き足しても動かない
    insertOrUpdateBlockForSlashMenu(editor, {
      type: MEETING_NOTE_TYPE,
      props: { createdAt: formatNoteStamp(), author: normalizeNoteAuthor(noteAuthorRef.current) },
    })
    editor.focus()
  }, [editor])

  const getSlashMenuItems = useCallback(
    async (query: string) =>
      filterSuggestionItems(
        [
          // 会議中にいちばん使うので先頭に置く（ユーザー要望・2026-09-15）
          {
            key: 'insert_meeting_note',
            title: '会議メモ',
            subtext: '会議中に足した補足として、書いた人と日時を添えて色を付けて残す',
            aliases: ['note', 'memo', 'メモ', '会議メモ', 'かいぎめも', 'コメント'],
            // 既定のブロックと同じ並びに置く（辞書から取って表記を揃える）
            group: jaLocale.slash_menu.paragraph.group,
            icon: <NotePencil size={18} />,
            onItemClick: insertMeetingNote,
          },
          {
            key: 'insert_task_line',
            title: 'タスクにする行',
            subtext: 'やること・期限・資料を選ぶと、タスク化できる形で1行入る',
            aliases: ['task', 'todo', 'タスク', 'やること', '決めること', '期限'],
            group: jaLocale.slash_menu.paragraph.group,
            icon: <Checks size={18} />,
            onItemClick: () => setTaskLineOpen(true),
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

  /**
   * 同時編集の器に種をまく。ここでしか取れない ProseMirror のスキーマを使う。
   * 同じ本文からは必ず同じ更新になるので、2人が同時にまいても二重にならない。
   */
  const seedCollabDoc = useCallback(
    (doc: YDoc, markdown: string) => seedMinutesDoc(doc, markdown, editor.pmSchema, schema.styleSchema),
    [editor, schema]
  )

  useEffect(() => {
    registerApi?.({ appendMarkdown, seedCollabDoc })
    return () => registerApi?.(null)
  }, [registerApi, appendMarkdown, seedCollabDoc])

  /**
   * 自分の名前と色を、部屋のみんなへ伝える。
   *
   * 載せるときは控えの値で作ってあるので、ここで画面のトークンから読み替えた値に
   * 入れ替える。名前はメンバー一覧が遅れて届くことがあるので、そのぶんもここで届く。
   * **色の番号自体は会期中変わらない**（変えても相手の画面には届かないため。
   * 理由は `cursorColors.ts`）。
   */
  // 載せるときに部品が入れた1通目と同じ値を覚えておく（同じ内容をもう1通配らない）
  const lastUserRef = useRef<string>(
    collaboration
      ? `${collaboration.userName}\u0000${cursorFallbackAt(collaboration.colorIndex)}`
      : ''
  )
  useEffect(() => {
    if (!collaboration) return
    const next = {
      name: collaboration.userName,
      color: cursorColorAt(collaboration.colorIndex),
    }
    // 中身が同じなら送らない（載せた直後に、同じ値をもう1通配らないため）
    const key = `${next.name}\u0000${next.color}`
    if (lastUserRef.current === key) return
    lastUserRef.current = key
    collaboration.awareness.setLocalStateField('user', next)
  }, [collaboration])

  /**
   * 直前の本文。チェックが「入った」瞬間だけを拾うために持つ。
   * 状態(useState)にすると打つたびに描き直すので ref にする。
   */
  const lastMarkdownRef = useRef(minutesMd)

  /**
   * その印が付いた行のチェックを付け外しする。
   * 字下げした行も拾うので入れ子まで辿る（トップ階層だけ見ると見つからない）。
   * 画面を離れた後に呼ばれることがあるので、触れなければ黙って諦める。
   */
  const setChecked = useCallback(
    (taskId: string, checked: boolean) => {
      try {
        editor.forEachBlock((block) => {
          if (block.type !== 'checkListItem') return true
          const hasMarker = (block.content as unknown[] | undefined)?.some(
            (c) =>
              (c as { type?: string }).type === TASK_MARKER_TYPE &&
              (c as { props?: { taskId?: string } }).props?.taskId === taskId
          )
          if (!hasMarker) return true
          editor.updateBlock(block, {
            props: { ...(block.props as Record<string, unknown>), checked },
          } as Parameters<typeof editor.updateBlock>[1])
          return false
        })
      } catch {
        // エディタが既に外れている等。チェックは動かせないが、理由はトーストで伝わる
      }
    },
    [editor]
  )

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
      // 相手がチェックを入れたぶんは、その人の画面で完了になる。こちらでも走らせると
      // 同じタスクを全員が完了にしに行く
      if (isApplyingRemote?.()) return

      const taskIds = detectCheckedTaskIds(prev, markdown)
      if (taskIds.length === 0) return

      for (const taskId of taskIds) {
        void resolver.run(taskId, 'complete').catch((err: unknown) => {
          setChecked(taskId, false)
          const kind = err instanceof MinutesCompleteError ? err.kind : 'unknown'
          const message = err instanceof Error ? err.message : completeFailureMessage('unknown')

          // まだ決まっていないだけなら、ここから2手を1回で進められるようにする。
          // 決めるのは人の仕事なので、自動では決めない（押してもらう）
          if (kind === 'spec_undecided') {
            toast.error(message, {
              action: {
                label: '決定にして完了にする',
                onClick: () => {
                  const now = resolverRef.current
                  if (!now) return
                  void now
                    .run(taskId, 'decide')
                    .then(() => now.run(taskId, 'complete'))
                    .then(() => {
                      setChecked(taskId, true)
                      toast.success('決定にして、完了にしました')
                    })
                    .catch((e: unknown) => {
                      toast.error(e instanceof Error ? e.message : completeFailureMessage('unknown'))
                    })
                },
              },
            })
            return
          }
          toast.error(message)
        })
      }
    },
    [setChecked, isApplyingRemote]
  )

  return (
    <div className="minutes-editor" data-testid="minutes-editor" ref={editorContainerRef}>
      <BlockNoteView
        editor={editor}
        // 途中で変えない（上の mountEditableRef の注を参照）。変えると取り消しが死ぬ
        editable={mountEditableRef.current}
        onChange={() => {
          const markdown = serializeMinutesBlocks(editor.document)
          handleCheckboxCompletion(markdown)
          onChange?.(markdown)
        }}
        theme={isDark ? 'dark' : 'light'}
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
