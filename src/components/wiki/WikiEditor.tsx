'use client'

import { useCallback, useState } from 'react'
import '@blocknote/core/fonts/inter.css'
import '@blocknote/mantine/style.css'
import { getDefaultReactSlashMenuItems, SuggestionMenuController, useCreateBlockNote } from '@blocknote/react'
import { BlockNoteView } from '@blocknote/mantine'
import { BlockNoteSchema, defaultBlockSpecs } from '@blocknote/core'
import { filterSuggestionItems } from '@blocknote/core/extensions'
import { ja as jaLocale } from '@blocknote/core/locales'
import { MeetingsBlock } from './blocks/MeetingsBlock'
import { WikiFileLinkPicker } from './WikiFileLinkPicker'
import { WikiPageLinkInsertPicker, type WikiPageInsertOption } from './WikiPageLinkInsertPicker'
import type { ProjectFile } from '@/lib/hooks/useFiles'

interface WikiEditorProps {
  initialContent?: string
  onChange?: (content: string) => void
  editable?: boolean
  orgId?: string
  spaceId?: string
  /** いま開いている Wiki ページの id。Wiki ページへのリンク挿入で自分自身を候補から外すために使う */
  currentPageId?: string
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

export function WikiEditor({
  initialContent,
  onChange,
  editable = true,
  orgId,
  spaceId,
  currentPageId,
}: WikiEditorProps) {
  const [isFilePickerOpen, setIsFilePickerOpen] = useState(false)
  const [isWikiPageLinkPickerOpen, setIsWikiPageLinkPickerOpen] = useState(false)
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
  })

  const getSlashMenuItems = useCallback(
    async (query: string) =>
      filterSuggestionItems(
        // 画面用の項目の型は key を省いているが、中身は既定の項目を広げたものなので key が残っている
        getDefaultReactSlashMenuItems(editor).filter(
          item => !HIDDEN_SLASH_MENU_ITEMS.has((item as { key?: string }).key ?? '')
        ),
        query
      ),
    [editor]
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

  // Insert a link to a project file at the cursor position.
  // Keep the panel open for internal-only files so the picker's persistent
  // warning ("client can't open this link") stays visible; close it otherwise.
  const handleSelectFile = (file: ProjectFile) => {
    editor.insertInlineContent([
      { type: 'link', href: `/api/files/${file.id}/download`, content: file.name },
    ] as Parameters<typeof editor.insertInlineContent>[0])
    if (file.clientVisible) {
      setIsFilePickerOpen(false)
    }
  }

  // 議事録エディタ(MinutesEditor)と同じ形でリンクを挿入する。`?page=<id>` のクエリ形は
  // アプリ全体の Wiki ページの参照形式なので、ここで独自の形を作らない
  const handleSelectWikiPage = (page: WikiPageInsertOption) => {
    editor.insertInlineContent([
      { type: 'link', href: `/${orgId}/project/${spaceId}/wiki?page=${page.id}`, content: page.title || '（無題）' },
    ] as Parameters<typeof editor.insertInlineContent>[0])
    setIsWikiPageLinkPickerOpen(false)
  }

  return (
    <div className="wiki-editor">
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
      {/* Insert toolbar for custom blocks */}
      {editable && (
        <div className="flex items-center gap-2 mt-2 px-1">
          <button
            type="button"
            onClick={handleInsertMeetingsBlock}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg transition-colors"
          >
            📋 議事録ブロックを挿入
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setIsFilePickerOpen(prev => !prev)
                setIsWikiPageLinkPickerOpen(false)
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg transition-colors"
            >
              📎 ファイルリンクを挿入
            </button>
            {isFilePickerOpen && (
              <div className="absolute bottom-full right-0 md:right-auto md:left-0 mb-2 z-10">
                <WikiFileLinkPicker spaceId={spaceId} onSelect={handleSelectFile} />
              </div>
            )}
          </div>
          {/* orgId/spaceId が無いとき（例: ポータルの読み取り専用表示）はリンク先が組み立てられないので出さない */}
          {orgId && spaceId && (
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setIsWikiPageLinkPickerOpen(prev => !prev)
                  setIsFilePickerOpen(false)
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg transition-colors"
              >
                🔗 Wikiページへのリンク
              </button>
              {isWikiPageLinkPickerOpen && (
                <div className="absolute bottom-full right-0 md:right-auto md:left-0 mb-2 z-10">
                  <WikiPageLinkInsertPicker
                    orgId={orgId}
                    spaceId={spaceId}
                    onSelect={handleSelectWikiPage}
                    excludePageId={currentPageId}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
