'use client'

import { useCallback, useState } from 'react'
import '@blocknote/core/fonts/inter.css'
import '@blocknote/mantine/style.css'
import { getDefaultReactSlashMenuItems, SuggestionMenuController, useCreateBlockNote } from '@blocknote/react'
import { BlockNoteView } from '@blocknote/mantine'
import { BlockNoteSchema, defaultBlockSpecs } from '@blocknote/core'
import { filterSuggestionItems } from '@blocknote/core/extensions'
import { ja as jaLocale } from '@blocknote/core/locales'
import { Notebook } from '@phosphor-icons/react'
import { MeetingsBlock } from './blocks/MeetingsBlock'
import { InsertLinkControl } from '@/components/editor/InsertLinkControl'
import { EditorToolbarButton } from '@/components/editor/EditorToolbarButton'
import { buildInsertLinkMenuItem, insertAppLink } from '@/components/editor/appLink'
import { useInAppLinkNavigation } from '@/components/editor/inAppLinkNavigation'
import type { AppLink } from '@/lib/navigation/appLinks'

interface WikiEditorProps {
  initialContent?: string
  onChange?: (content: string) => void
  editable?: boolean
  orgId?: string
  spaceId?: string
  /** 本文中のリンクで画面を移る前に呼ぶ。待ち時間中の自動保存を確定させて書きかけを落とさない */
  onBeforeNavigate?: () => void | Promise<void>
}

// Custom schema with meetings block
const schema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    meetingsList: MeetingsBlock(),
  },
})

// BlockNote の日本語辞書。フォーカスした空行の案内だけ、「/」でメニューが開くと伝わる言い回しにする
const WIKI_DICTIONARY = {
  ...jaLocale,
  placeholders: {
    ...jaLocale.placeholders,
    default: '文字を入力、または「/」でメニューを開く',
  },
}

// 「/」メニューに出さない項目。動画・音声はこの画面の安全設定（CSP の default-src 'self'）で
// 外部の URL を再生できず、エディタからアップロードする先も無いため
const HIDDEN_SLASH_MENU_ITEMS = new Set(['video', 'audio'])

export function WikiEditor({ initialContent, onChange, editable = true, orgId, spaceId, onBeforeNavigate }: WikiEditorProps) {
  const isInternalApp = Boolean(orgId && spaceId)
  const editorContainerRef = useInAppLinkNavigation(onBeforeNavigate, isInternalApp)
  const [isLinkPickerOpen, setIsLinkPickerOpen] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let parsedContent: any[] | undefined
  if (initialContent) {
    try {
      parsedContent = JSON.parse(initialContent)
    } catch {
      parsedContent = undefined
    }
  }

  const editor = useCreateBlockNote({
    schema,
    initialContent: parsedContent,
    dictionary: WIKI_DICTIONARY,
  })

  const getSlashMenuItems = useCallback(
    async (query: string) =>
      filterSuggestionItems(
        [
          // 「/」からもリンクを差し込めるようにする。押すと本文の下のパネルが開く
          ...(orgId && spaceId ? [buildInsertLinkMenuItem(() => setIsLinkPickerOpen(true))] : []),
          // 画面用の項目の型は key を省いているが、中身は既定の項目を広げたものなので key が残っている
          ...getDefaultReactSlashMenuItems(editor).filter(
            item => !HIDDEN_SLASH_MENU_ITEMS.has((item as { key?: string }).key ?? '')
          ),
        ],
        query
      ),
    [editor, orgId, spaceId]
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

  // カーソル位置にアプリの中へのリンクを差し込む。社内のみのファイルのときは、
  // 「相手先には開けない」という注意を読んでもらうためパネルを開いたままにする
  const handleSelectLink = (link: AppLink) => {
    insertAppLink(editor, link)
    if (!link.href.startsWith('/api/files/')) {
      setIsLinkPickerOpen(false)
    }
  }

  return (
    <div className="wiki-editor" ref={editorContainerRef}>
      <BlockNoteView
        editor={editor}
        editable={editable}
        onChange={() => {
          const json = JSON.stringify(editor.document)
          onChange?.(json)
        }}
        theme="light"
        slashMenu={false}
      >
        {/* 既定のメニューの代わりに、出す項目を絞った「/」メニューを置く。
            行の左の「＋」もこのメニューを開くので、これを外すと「＋」も押して何も起きなくなる */}
        <SuggestionMenuController triggerCharacter="/" getItems={getSlashMenuItems} />
      </BlockNoteView>
      {/* 本文の下の差し込みツールバー */}
      {editable && (
        <div className="flex items-center gap-2 mt-2 px-1">
          {isInternalApp && orgId && spaceId && (
            <InsertLinkControl
              orgId={orgId}
              spaceId={spaceId}
              isOpen={isLinkPickerOpen}
              onToggle={() => setIsLinkPickerOpen(prev => !prev)}
              onSelect={handleSelectLink}
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
