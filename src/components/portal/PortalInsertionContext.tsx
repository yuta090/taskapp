'use client'

import { createContext } from 'react'
import type { DocInsertion, DocInsertionKind } from '@/lib/doc-insertions/logic'

/**
 * 相手先ポータルの議事録で「書き足す」ための道具（DOC_VOTE_SPEC §5）。置いた画面でだけ「＋」が出る。
 * rows は自分の差し込み（RLS で自分の分だけ返る）。
 */
export interface PortalInsertionContextValue {
  rows: DocInsertion[]
  /** anchor: その行の Markdown（この後ろに足す）。null は末尾 */
  create: (kind: DocInsertionKind, content: string, anchor: string | null) => Promise<void>
  withdraw: (id: string) => Promise<void>
}

export const PortalInsertionContext = createContext<PortalInsertionContextValue | null>(null)
