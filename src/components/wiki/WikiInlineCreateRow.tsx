'use client'

/**
 * 一覧の先頭に出すインラインの名前入力行（PR5: フォルダの作成）。
 * モーダルは禁止のため、シート・ダイアログではなくこの行だけで作成を完結させる。
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Folder } from '@phosphor-icons/react'

interface WikiInlineCreateRowProps {
  placeholder?: string
  onSubmit: (title: string) => Promise<void> | void
  onCancel: () => void
}

export function WikiInlineCreateRow({ placeholder = 'フォルダ名', onSubmit, onCancel }: WikiInlineCreateRowProps) {
  const [title, setTitle] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSubmit = async () => {
    const trimmed = title.trim()
    if (!trimmed || submitting) return
    setSubmitting(true)
    try {
      await onSubmit(trimmed)
    } finally {
      setSubmitting(false)
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void handleSubmit()
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    }
  }

  return (
    <div data-testid="wiki-inline-create-row" className="flex items-center gap-2 pl-4 pr-4 py-2.5 border-b border-gray-100">
      <Folder weight="fill" className="text-indigo-400 text-sm flex-shrink-0" aria-hidden="true" />
      <input
        ref={inputRef}
        type="text"
        value={title}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        aria-label={placeholder}
        disabled={submitting}
        className="flex-1 min-w-0 px-2 py-1 text-sm border border-indigo-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
      />
    </div>
  )
}
