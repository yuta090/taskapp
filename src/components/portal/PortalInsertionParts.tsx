'use client'

import { useState } from 'react'
import { DocInsertionView } from '@/components/editor/docInsertion/DocInsertionView'
import { checkInsertionContent, insertionErrorMessage, type DocInsertion, type DocInsertionKind } from '@/lib/doc-insertions/logic'
import { jstNow } from '@/lib/datetime/jstNow'
import { formatNoteStamp } from '@/lib/minutes/noteStamp'

/** DB の時刻（UTC）を、本文の目印と同じ形（日本時間 `2026-09-26T14:30`）にする */
export function insertionStamp(createdAt: string): string {
  const d = new Date(createdAt)
  return Number.isNaN(d.getTime()) ? '' : formatNoteStamp(jstNow(d))
}

/**
 * 書き足す欄。行かメモかを選んで送る。本文の検査は DB と同じ（目印 <!-- --> は使えない）。
 * Ctrl / ⌘ + Enter でも送れる。ポータルの議事録はエディタではないので、ふつうの入力欄を置ける。
 */
export function InsertionComposer({
  onSubmit,
  onCancel,
}: {
  onSubmit: (kind: DocInsertionKind, content: string) => Promise<void>
  onCancel: () => void
}) {
  const [kind, setKind] = useState<DocInsertionKind>('paragraph')
  const [content, setContent] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const problem = checkInsertionContent(content)
  const blocked = problem !== null || sending

  const submit = async () => {
    if (blocked) return
    setSending(true)
    setError(null)
    try {
      await onSubmit(kind, content)
    } catch (e) {
      setError(insertionErrorMessage(e))
    } finally {
      setSending(false)
    }
  }

  return (
    <form
      aria-label="書き足す"
      className="my-2 rounded-lg border border-gray-200 bg-surface p-2"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <div className="mb-1.5 flex gap-3 text-xs text-gray-600" role="radiogroup" aria-label="種類">
        {(
          [
            ['paragraph', '行'],
            ['meeting_note', 'メモ'],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="flex items-center gap-1">
            <input type="radio" name="insertion-kind" checked={kind === value} onChange={() => setKind(value)} />
            {label}
          </label>
        ))}
      </div>
      <textarea
        autoFocus
        rows={2}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel()
          else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            void submit()
          }
        }}
        placeholder="書き足す内容（社内の人が確認してから本文に入ります）"
        className="w-full resize-y rounded border border-gray-200 bg-surface px-2 py-1 text-sm text-gray-900 focus:border-gray-400 focus:outline-none"
      />
      {problem === 'invalid' && <p className="mt-1 text-xs text-red-600">{insertionErrorMessage({ message: 'invalid_content' })}</p>}
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
      <div className="mt-1.5 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-100">
          やめる
        </button>
        <button
          type="submit"
          disabled={blocked}
          className="rounded bg-blue-600 px-2.5 py-1 text-xs text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          送る
        </button>
      </div>
    </form>
  )
}

/** 取り消し・削除のボタン。失敗したら理由をその場に出す */
export function WithdrawButton({ label, onWithdraw }: { label: string; onWithdraw: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setError(null)
          try {
            await onWithdraw()
          } catch (e) {
            setError(insertionErrorMessage(e))
          } finally {
            setBusy(false)
          }
        }}
        className="text-gray-500 hover:underline disabled:opacity-50"
      >
        {label}
      </button>
      {error && (
        <span role="alert" className="text-red-600">
          {error}
        </span>
      )}
    </>
  )
}

/** 自分の差し込みで、本文にまだ入っていないもの（反映待ち） */
export function PendingInsertion({ row, onWithdraw }: { row: DocInsertion; onWithdraw: (id: string) => Promise<void> }) {
  return (
    <div className="my-1.5 opacity-80">
      <DocInsertionView
        kind={row.kind}
        author={row.author_name}
        createdAt={insertionStamp(row.created_at)}
        badge={<span className="rounded bg-gray-100 px-1 text-gray-500">反映待ち</span>}
        actions={<WithdrawButton label="取り消す" onWithdraw={() => onWithdraw(row.id)} />}
      >
        <span className="text-sm text-gray-700">{row.content}</span>
      </DocInsertionView>
    </div>
  )
}
