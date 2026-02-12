'use client'

import '@blocknote/core/fonts/inter.css'
import '@blocknote/mantine/style.css'
import { useCreateBlockNote } from '@blocknote/react'
import { BlockNoteView } from '@blocknote/mantine'
import { BlockNoteSchema, defaultBlockSpecs } from '@blocknote/core'
import { MeetingsBlock } from './blocks/MeetingsBlock'

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }] as any,
      editor.getTextCursorPosition().block,
      'after'
    )
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
        </div>
      )}
    </div>
  )
}
