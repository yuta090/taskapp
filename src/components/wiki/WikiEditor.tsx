'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import '@blocknote/core/fonts/inter.css'
import '@blocknote/mantine/style.css'
import { getDefaultReactSlashMenuItems, SuggestionMenuController, useCreateBlockNote } from '@blocknote/react'
import { BlockNoteView } from '@blocknote/mantine'
import { BlockNoteSchema, defaultBlockSpecs } from '@blocknote/core'
import { filterSuggestionItems, insertOrUpdateBlockForSlashMenu } from '@blocknote/core/extensions'
import { ja as jaLocale } from '@blocknote/core/locales'
import { CheckSquareOffset, ListBullets, Notebook, NotePencil } from '@phosphor-icons/react'
import { MeetingsBlock } from './blocks/MeetingsBlock'
import { dividerSpec, meetingNoteSpec, tableOfContentsSpec } from '@/components/meeting/minutesBlocks'
import { InsertLinkControl } from '@/components/editor/InsertLinkControl'
import type { AppLinkSelection } from '@/components/editor/AppLinkPicker'
import { EditorToolbarButton } from '@/components/editor/EditorToolbarButton'
import { buildInsertLinkMenuItems, insertAppLink } from '@/components/editor/appLink'
import { useInAppLinkNavigation } from '@/components/editor/inAppLinkNavigation'
import { useEditorClickBehaviors } from '@/components/editor/editorClickBehaviors'
import { STABLE_EDITOR_DOM_ATTRIBUTES, useStableEditable } from '@/components/editor/useStableEditable'
import type { AppLinkKind } from '@/lib/navigation/appLinks'
import { DIVIDER_TYPE, MEETING_NOTE_TYPE, TOC_TYPE } from '@/lib/minutes/markdown'
import { formatNoteStamp, normalizeNoteAuthor } from '@/lib/minutes/noteStamp'
import { useIsDarkTheme } from '@/lib/hooks/useIsDarkTheme'
import { DOC_POLL_TYPE } from '@/lib/doc-polls/logic'
import type { DocPollReasonRequired } from '@/lib/doc-polls/types'
import { docPollSpec } from '@/components/editor/docPoll/docPollBlock'
import { DocPollHost } from '@/components/editor/docPoll/DocPollHost'

interface WikiEditorProps {
  initialContent?: string
  onChange?: (content: string) => void
  editable?: boolean
  orgId?: string
  spaceId?: string
  /** いま開いている Wiki ページの id。Wiki ページへのリンク挿入で自分自身を候補から外すために使う */
  currentPageId?: string
  /** 本文中のリンクで画面を移る前に呼ぶ。待ち時間中の自動保存を確定させて書きかけを落とさない */
  onBeforeNavigate?: () => void | Promise<void>
  /**
   * メモに残す「書いた人」の名前（プロフィールの表示名）。押した時点の値を焼き付ける。
   * メンバー一覧の読み込み中や分からないときは空で、そのときは日時だけが残る。
   */
  noteAuthorName?: string
  /**
   * 投票ブロックに配るもの（社内の Wiki 画面だけが渡す）。無い画面（相手先ポータルなど）では
   * 「/」に投票を出さず、置いてある投票は「この画面では投票できません」と出す。
   */
  poll?: {
    wikiPageId: string
    currentUserId: string | null
    nameOf: (userId: string) => string
  }
}

// Custom schema with meetings block
const schema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    meetingsList: MeetingsBlock(),
    // 議事録の「会議メモ」と同じブロック。Wiki では「メモ」と呼ぶ。相手先ポータルの Wiki も
    // このスキーマで読み取り専用に描くので、ここに入れておけばポータルでも同じ見た目で読める
    [MEETING_NOTE_TYPE]: meetingNoteSpec,
    [TOC_TYPE]: tableOfContentsSpec,
    // 既定の区切り線に `---` ＋スペースの入力ルールだけ足したもの
    [DIVIDER_TYPE]: dividerSpec,
    // 投票。本文には番号と理由必須の設定だけを持ち、票は DB に置く（DOC_VOTE_SPEC）
    [DOC_POLL_TYPE]: docPollSpec,
  },
})

// BlockNote の日本語辞書。フォーカスした空行の案内だけ、「/」でメニューが開くと伝わる言い回しにする
const WIKI_DICTIONARY = {
  ...jaLocale,
  placeholders: {
    ...jaLocale.placeholders,
    default: '文字を入力、または「/」でメニューを開く',
    [DOC_POLL_TYPE]: '議題（書かなくてもよい）',
  },
}

// 「/」メニューに出さない項目。動画・音声はこの画面の安全設定（CSP の default-src 'self'）で
// 外部の URL を再生できず、エディタからアップロードする先も無いため
const HIDDEN_SLASH_MENU_ITEMS = new Set(['video', 'audio'])

export function WikiEditor({
  initialContent,
  onChange,
  editable = true,
  orgId,
  spaceId,
  currentPageId,
  onBeforeNavigate,
  noteAuthorName,
  poll,
}: WikiEditorProps) {
  const isInternalApp = Boolean(orgId && spaceId)
  const editorContainerRef = useInAppLinkNavigation(onBeforeNavigate, isInternalApp)
  /**
   * 開いているリンクの種類と、開いた回数。null なら閉じている。
   * 回数を持つのは、**同じ種類で開き直したとき**にもパネルを作り直して検索欄に
   * カーソルを戻すため（持たないと「/」から呼んでも何も起きないように見える）
   */
  // BlockNote は色を CSS でなく props のテーマで受け取るので、真偽値で渡す
  const isDark = useIsDarkTheme()

  const [linkPicker, setLinkPicker] = useState<{ kind: AppLinkKind; seq: number } | null>(null)
  const openLinkPicker = useCallback((kind: AppLinkKind) => {
    setLinkPicker((prev) => ({ kind, seq: (prev?.seq ?? 0) + 1 }))
  }, [])
  const closeLinkPicker = useCallback(() => setLinkPicker(null), [])
  // 名前はメンバー一覧を読み終えてから届く。値のまま「/」メニューの項目に閉じ込めると、
  // 届いたときに項目の取り方ごと作り直しになる（開いているメニューが取り直しになる）ので、
  // ref に入れて押した時点の値を読む（描画中には書き換えず、描き終えてから入れ直す）
  const noteAuthorRef = useRef(noteAuthorName)
  useEffect(() => {
    noteAuthorRef.current = noteAuthorName
  }, [noteAuthorName])
  // 本文の JSON を読み直すのは最初の1回だけ。`useCreateBlockNote` は初回しか
  // initialContent を見ないので、描き直しのたびに parse すると丸ごと捨てる仕事になる
  // （挿入パネルの開閉で描き直しが増えたため、ここで1回に絞る）。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [parsedContent] = useState<any[] | undefined>(() => {
    if (!initialContent) return undefined
    try {
      return JSON.parse(initialContent)
    } catch {
      return undefined
    }
  })

  const editor = useCreateBlockNote({
    schema,
    initialContent: parsedContent,
    dictionary: WIKI_DICTIONARY,
    domAttributes: { editor: STABLE_EDITOR_DOM_ATTRIBUTES },
  })

  // 「書いてよいか」は載せたときの値のまま渡し、以後の変化は載せ直さない道で当てる
  // （変えるとエディタが丸ごと作り直される。理由は useStableEditable の注を参照）
  const mountEditable = useStableEditable(editor, editable)

  // 折りたたみの題名クリックで開閉・表の列の境目のダブルクリックで幅合わせ
  useEditorClickBehaviors(editorContainerRef, editor)

  /**
   * 今の行をメモに変える（空の行なら、その行がそのままメモになる）。
   * 書いた日時と名前はその場で焼き付ける。あとから本文を直しても、別の人が書き足しても動かない。
   */
  const insertNote = useCallback(() => {
    insertOrUpdateBlockForSlashMenu(editor, {
      type: MEETING_NOTE_TYPE,
      props: { createdAt: formatNoteStamp(), author: normalizeNoteAuthor(noteAuthorRef.current) },
    })
    editor.focus()
  }, [editor])

  /** 今の行に目次を置く。中身は持たず、開くたびに見出しから引き直される。 */
  const insertToc = useCallback(() => {
    insertOrUpdateBlockForSlashMenu(editor, { type: TOC_TYPE, props: {} })
    editor.focus()
  }, [editor])

  /**
   * 今の行を投票にする（空の行ならその行が投票になる。書いてある字は議題になる）。
   * 番号はここで作って本文に置き、DB の投票は DocPollHost が作る（通信を待たずに置ける）。
   */
  const insertPoll = useCallback(
    (reasonRequired: DocPollReasonRequired) => {
      insertOrUpdateBlockForSlashMenu(editor, {
        type: DOC_POLL_TYPE,
        props: { pollId: crypto.randomUUID(), reasonRequired },
      })
      editor.focus()
    },
    [editor]
  )

  const hasPoll = poll != null

  const getSlashMenuItems = useCallback(
    async (query: string) =>
      filterSuggestionItems(
        [
          // 投票はいちばん上に置く（「/v」で先頭に出る）
          ...(hasPoll
            ? [
                {
                  key: 'insert_vote',
                  title: '投票',
                  subtext: 'OK・NG・保留を押してもらい、誰が押したかを残す',
                  aliases: ['vote', 'v', 'poll', 'ok', 'ng', 'touhyou', 'とうひょう', '投票'],
                  group: jaLocale.slash_menu.paragraph.group,
                  icon: <CheckSquareOffset size={18} />,
                  onItemClick: () => insertPoll('none'),
                },
                {
                  key: 'insert_vote_must',
                  title: '投票（理由必須）',
                  subtext: 'NG と保留は理由を書かないと押せない',
                  aliases: ['votemust', 'vote-must', 'must', 'hissu', 'ひっす', '必須', '投票必須'],
                  group: jaLocale.slash_menu.paragraph.group,
                  icon: <CheckSquareOffset size={18} weight="fill" />,
                  onItemClick: () => insertPoll('ng_hold'),
                },
              ]
            : []),
          {
            key: 'insert_note',
            title: 'メモ',
            subtext: '書いた人と日時を添えて、背景に色を付けて残す',
            aliases: ['note', 'memo', 'メモ', 'めも', 'コメント', '会議メモ'],
            // 既定のブロックと同じ並びに置く（辞書から取って表記を揃える）
            group: jaLocale.slash_menu.paragraph.group,
            icon: <NotePencil size={18} />,
            onItemClick: insertNote,
          },
          {
            key: 'insert_toc',
            title: '目次',
            subtext: '見出しの一覧。開くたびに引き直すので古くならない',
            aliases: ['toc', 'mokuji', 'もくじ', '目次', 'contents', 'index'],
            group: jaLocale.slash_menu.paragraph.group,
            icon: <ListBullets size={18} />,
            onItemClick: insertToc,
          },
          // 「/」からもリンクを差し込めるようにする。押すと本文の下のパネルが開く
          ...(orgId && spaceId ? buildInsertLinkMenuItems(openLinkPicker) : []),
          // 画面用の項目の型は key を省いているが、中身は既定の項目を広げたものなので key が残っている
          ...getDefaultReactSlashMenuItems(editor).filter(
            item => !HIDDEN_SLASH_MENU_ITEMS.has((item as { key?: string }).key ?? '')
          ),
        ],
        query
      ),
    [editor, orgId, spaceId, openLinkPicker, insertNote, insertToc, insertPoll, hasPoll]
  )

  // Insert meetings block with orgId/spaceId (toolbar button below the editor)
  const handleInsertMeetingsBlock = () => {
    if (!orgId || !spaceId) return
    editor.insertBlocks(
      [{
        type: 'meetingsList',
        props: { orgId, spaceId, limit: '5' },
      }] as Parameters<typeof editor.insertBlocks>[0],
      editor.getTextCursorPosition().block,
      'after'
    )
  }

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

  const editorView = (
    <BlockNoteView
      editor={editor}
      editable={mountEditable}
      onChange={() => {
        const json = JSON.stringify(editor.document)
        onChange?.(json)
      }}
      theme={isDark ? 'dark' : 'light'}
      slashMenu={false}
    >
      {/* 既定のメニューの代わりに、出す項目を絞った「/」メニューを置く。
          行の左の「＋」もこのメニューを開くので、これを外すと「＋」も押して何も起きなくなる */}
      <SuggestionMenuController triggerCharacter="/" getItems={getSlashMenuItems} />
    </BlockNoteView>
  )

  return (
    <div className="wiki-editor" ref={editorContainerRef}>
      {poll ? (
        <DocPollHost
          editor={editor as never}
          source={{ wikiPageId: poll.wikiPageId }}
          currentUserId={poll.currentUserId}
          nameOf={poll.nameOf}
          editable={editable}
        >
          {editorView}
        </DocPollHost>
      ) : (
        editorView
      )}
      {/* 本文の下の差し込みツールバー。PDFで保存するときは紙に載せない（押すためのもの） */}
      {editable && (
        <div data-print-hide className="flex items-center gap-2 mt-2 px-1">
          {/* 「/」を知らなくても押せる場所に出す（議事録の「会議メモ」ボタンと同じ） */}
          <EditorToolbarButton
            icon={<NotePencil />}
            label="メモ"
            onClick={insertNote}
            data-testid="wiki-insert-note"
          />
          {isInternalApp && orgId && spaceId && (
            <InsertLinkControl
              orgId={orgId}
              spaceId={spaceId}
              openKind={linkPicker?.kind ?? null}
              openSeq={linkPicker?.seq}
              onToggle={() => (linkPicker ? closeLinkPicker() : openLinkPicker('file'))}
              onClose={closeLinkPicker}
              onSelect={handleSelectLink}
              excludeWikiPageId={currentPageId}
            />
          )}
          <EditorToolbarButton
            icon={<Notebook />}
            label="議事録の一覧を挿入"
            onClick={handleInsertMeetingsBlock}
          />
        </div>
      )}
    </div>
  )
}
