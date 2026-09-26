'use client'

import type { ReactNode } from 'react'
import { formatNoteStampLabel, normalizeNoteAuthor } from '@/lib/minutes/noteStamp'
import type { DocInsertionKind } from '@/lib/doc-insertions/logic'

/**
 * 相手先が足した行・メモの見た目（DOC_VOTE_SPEC §5.1）。エディタに依らない（相手先ポータルの議事録も使う）。
 * - メモ（meeting_note）: 会議メモと同じ帯。右に書いた人と日時
 * - 行（paragraph）: 普通の行。右端に書いた人と日時を小さく添える（相手先が足したと分かるように）
 * 本文は children で渡すか、エディタの中では contentRef の場所に BlockNote が入れる。
 * 色にアンバー/オレンジは使わない（「相手先に見える」印の色なので）。
 */
export function DocInsertionView({
  kind,
  author,
  createdAt,
  contentRef,
  children,
  badge,
  actions,
}: {
  kind: DocInsertionKind
  author: string
  createdAt: string
  contentRef?: (node: HTMLElement | null) => void
  children?: ReactNode
  /** 反映待ちなどの印 */
  badge?: ReactNode
  /** 取り消し・削除などのボタン（相手先ポータルで本人にだけ出す） */
  actions?: ReactNode
}) {
  const label = formatNoteStampLabel(createdAt)
  const name = normalizeNoteAuthor(author)
  const body =
    children !== undefined ? (
      <div className="min-w-0 flex-1 whitespace-pre-wrap">{children}</div>
    ) : (
      <div className="min-w-0 flex-1" ref={contentRef} />
    )
  const stamp = (
    <span contentEditable={false} className="flex shrink-0 select-none items-center gap-1.5 pt-0.5 text-[10px] text-gray-400">
      {badge}
      {name && (
        <span className="max-w-[10rem] truncate text-gray-500" title={name}>
          {name}
        </span>
      )}
      {label && <span>{label}</span>}
      {actions}
    </span>
  )
  return (
    <div
      data-testid="doc-insertion"
      data-kind={kind}
      className={
        kind === 'meeting_note'
          ? 'flex w-full items-start gap-2 rounded border-l-4 border-blue-200 bg-blue-100 py-1 pl-3 pr-2'
          : 'flex w-full items-start gap-2'
      }
    >
      {body}
      {stamp}
    </div>
  )
}
