'use client'

import '@blocknote/core/fonts/inter.css'
import '@blocknote/mantine/style.css'
import { useCreateBlockNote } from '@blocknote/react'
import { BlockNoteView } from '@blocknote/mantine'
import type { Block } from '@blocknote/core'

interface WikiEditorProps {
  initialContent?: string
  onChange?: (content: string) => void
  editable?: boolean
}

export function WikiEditor({ initialContent, onChange, editable = true }: WikiEditorProps) {
  let parsedContent: Block[] | undefined
  if (initialContent) {
    try {
      parsedContent = JSON.parse(initialContent)
    } catch {
      parsedContent = undefined
    }
  }

  const editor = useCreateBlockNote({
    initialContent: parsedContent,
  })

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
      />
    </div>
  )
}
