'use client'

import { useState } from 'react'
import type { DocInsertion, DocInsertionKind } from '@/lib/doc-insertions/logic'
import { DocInsertionView } from '@/components/editor/docInsertion/DocInsertionView'
import { InsertionComposer, WithdrawButton, insertionStamp } from './PortalInsertionParts'

const STATUS_LABEL: Partial<Record<DocInsertion['status'], string>> = {
  pending: '反映待ち',
  // Wiki の相手先の画面は公開した時点の控えなので、反映済みでも次に公開されるまで本文には出ない
  applied: '反映済み（次の公開で本文に出ます）',
  remove_requested: '削除待ち',
}

/**
 * 相手先ポータルの Wiki で、ページの末尾に行・メモを書き足す欄と、自分の書き足しの一覧（DOC_VOTE_SPEC §5）。
 * ポータルの Wiki は読むだけのエディタで出しているので、行ごとの「＋」は置かず末尾に足す。
 */
export function PortalWikiInsertions({
  rows,
  create,
  withdraw,
}: {
  rows: DocInsertion[]
  create: (kind: DocInsertionKind, content: string, anchor: string | null) => Promise<void>
  withdraw: (id: string) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const shown = rows.filter((r) => STATUS_LABEL[r.status])
  return (
    <div data-print-hide className="mt-4 border-t border-gray-200 pt-3">
      {shown.length > 0 && (
        <ul aria-label="あなたの書き足し" className="mb-3 space-y-1.5">
          {shown.map((r) => (
            <li key={r.id}>
              <DocInsertionView
                kind={r.kind}
                author={r.author_name}
                createdAt={insertionStamp(r.created_at)}
                badge={<span className="rounded bg-gray-100 px-1 text-gray-500">{STATUS_LABEL[r.status]}</span>}
                actions={
                  r.status === 'pending' ? (
                    <WithdrawButton label="取り消す" onWithdraw={() => withdraw(r.id)} />
                  ) : r.status === 'applied' ? (
                    <WithdrawButton label="削除" onWithdraw={() => withdraw(r.id)} />
                  ) : undefined
                }
              >
                <span className="text-sm text-gray-700">{r.content}</span>
              </DocInsertionView>
            </li>
          ))}
        </ul>
      )}
      {open ? (
        <InsertionComposer
          onSubmit={async (kind, content) => {
            await create(kind, content, null)
            setOpen(false)
          }}
          onCancel={() => setOpen(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded border border-dashed border-gray-300 px-3 py-1 text-xs text-gray-500 hover:bg-gray-50"
        >
          ＋ 行・メモを足す
        </button>
      )}
    </div>
  )
}
