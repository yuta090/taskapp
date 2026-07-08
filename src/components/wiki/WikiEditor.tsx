'use client'

import { useState } from 'react'
import '@blocknote/core/fonts/inter.css'
import '@blocknote/mantine/style.css'
import { useCreateBlockNote } from '@blocknote/react'
import { BlockNoteView } from '@blocknote/mantine'
import { BlockNoteSchema, defaultBlockSpecs } from '@blocknote/core'
import { MeetingsBlock } from './blocks/MeetingsBlock'
import { WikiFileLinkPicker } from './WikiFileLinkPicker'
import type { ProjectFile } from '@/lib/hooks/useFiles'

interface WikiEditorProps {
  initialContent?: string
  onChange?: (content: string) => void
  editable?: boolean
  orgId?: string
  spaceId?: string
}

// Custom schema with meetings block
const schema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    meetingsList: MeetingsBlock(),
  },
})

export function WikiEditor({ initialContent, onChange, editable = true, orgId, spaceId }: WikiEditorProps) {
  const [isFilePickerOpen, setIsFilePickerOpen] = useState(false)
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
  })

  // Insert meetings block with orgId/spaceId via slash menu
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
      />
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
              onClick={() => setIsFilePickerOpen(prev => !prev)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg transition-colors"
            >
              📎 ファイルリンクを挿入
            </button>
            {isFilePickerOpen && (
              <div className="absolute bottom-full left-0 mb-2 z-10">
                <WikiFileLinkPicker spaceId={spaceId} onSelect={handleSelectFile} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
