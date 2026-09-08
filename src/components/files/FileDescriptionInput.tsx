'use client'

import { memo, useRef, useState } from 'react'

// API・migration(files.description の check 制約)と揃える
export const MAX_FILE_DESCRIPTION_LENGTH = 1000

interface FileDescriptionInputProps {
  initialValue: string
  /** 保存する値。空にしたときは null(説明を消す) */
  onCommit: (value: string | null) => void
  /** 保存せずに閉じる(Esc・中身が変わっていないとき) */
  onCancel: () => void
  testId: string
}

/**
 * 説明文のその場編集。保存ボタンは置かず Enter / フォーカス外れで保存する。
 *
 * 書きかけの文字はこの部品の中だけで持つ。一覧側(FilesPageClient)が持つと、
 * 1文字打つたびに一覧の全行を作り直すことになり、ファイルが増えるほど入力が遅れる。
 */
export const FileDescriptionInput = memo(function FileDescriptionInput({
  initialValue,
  onCommit,
  onCancel,
  testId,
}: FileDescriptionInputProps) {
  const [draft, setDraft] = useState(initialValue)
  // Esc で閉じた直後の blur で二重に保存しないための目印
  const closedRef = useRef(false)

  const commit = () => {
    if (closedRef.current) return
    closedRef.current = true

    const next = draft.trim()
    if (next === initialValue.trim()) {
      onCancel()
      return
    }
    onCommit(next || null)
  }

  const cancel = () => {
    if (closedRef.current) return
    closedRef.current = true
    onCancel()
  }

  return (
    <input
      type="text"
      autoFocus
      data-testid={testId}
      value={draft}
      maxLength={MAX_FILE_DESCRIPTION_LENGTH}
      placeholder="何のファイルか、ひとことで（Enterで保存・Escでやめる）"
      aria-label="ファイルの説明"
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          cancel()
        }
      }}
      onBlur={commit}
      className="w-full px-2 py-1 text-xs border border-blue-300 rounded bg-surface text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
    />
  )
})
