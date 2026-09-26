/**
 * 相手先の差し込み（DOC_VOTE_SPEC §5）の、画面にも通信にも依らない部分。
 */

/** 本文（BlockNote）での差し込みのブロックの型名。文書に残るので変えない */
export const DOC_INSERTION_TYPE = 'docInsertion'

/** paragraph = 普通の行 / meeting_note = メモ（会議メモと同じ帯） */
export type DocInsertionKind = 'paragraph' | 'meeting_note'

export const DOC_INSERTION_CONTENT_MAX = 2000

/** 反映待ちは1人×1文書この件数まで（DB と同じ） */
export const DOC_INSERTION_PENDING_MAX = 20

export type DocInsertionStatus = 'pending' | 'applied' | 'withdrawn' | 'remove_requested' | 'removed'

export interface DocInsertion {
  id: string
  org_id: string
  space_id: string
  wiki_page_id: string | null
  meeting_id: string | null
  kind: DocInsertionKind
  content: string
  anchor: string | null
  status: DocInsertionStatus
  anchor_missed: boolean
  author_id: string
  author_name: string
  created_at: string
}

/**
 * 本文として受け付けるか（DB の検査と同じ）。受け付けないときは理由を返す。
 * 目印（<!-- -->）は書かせない。議事録の Markdown で本物の目印として読まれるため
 */
export function checkInsertionContent(content: string): 'empty' | 'too_long' | 'invalid' | null {
  if (/^[\s　]*$/.test(content)) return 'empty'
  if (content.length > DOC_INSERTION_CONTENT_MAX) return 'too_long'
  if (/[\u0001-\u0009\u000b-\u001f\u007f]/.test(content)) return 'invalid'
  if (content.includes('<!--') || content.includes('-->')) return 'invalid'
  return null
}

/** 差し込みを送れなかった理由を画面の言葉にする（DB の関数が返す印と対） */
export function insertionErrorMessage(error: unknown): string {
  const e = (error ?? {}) as { code?: string; message?: string }
  switch (e.message) {
    case 'too_many_pending':
      return `反映待ちが${DOC_INSERTION_PENDING_MAX}件あります。反映されるまでお待ちください`
    case 'empty_content':
      return '本文を書いてください'
    case 'content_too_long':
      return `本文は${DOC_INSERTION_CONTENT_MAX}字までです`
    case 'invalid_content':
      return '使えない文字が含まれています（<!-- と --> は使えません）'
    case 'invalid_state':
      return 'この行はもう取り消せません'
  }
  if (e.code === '42501') return 'この文書には書き足せません'
  return '送れませんでした。もう一度お試しください'
}
