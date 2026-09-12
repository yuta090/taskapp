/**
 * 議事録ブロック木から「社内向けの相対リンク」を取り除く純関数。
 *
 * 相手先（お客さん）はポータル越しに議事録を読むが、社内の Wiki ページや
 * ファイルは開けない。議事録の本文に社内向けの相対リンク（例: Wiki ページへの
 * リンク）が書かれていても、ポータルでは押せるリンクにせず表示文字だけの
 * 文字として見せる。押して「権限がありません」に飛ばさないための処理で、
 * `markdown.ts` の HREF_SCHEME_RE と同じ考え方（scheme が無ければ相対リンク）
 * を使う。React・DOM には依存しない。
 */
import type {
  MinutesBlock,
  MinutesInlineContent,
  MinutesTableCell,
  MinutesTableRow,
} from './markdown'

/** `英字:` の形の scheme(RFC 3986 と同じ字種)。markdown.ts の HREF_SCHEME_RE と揃える。 */
const HREF_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/

/** 相手先がポータルで開ける道。このアプリの絶対URLでも、ここ配下なら押せるリンクのまま残す。 */
const PORTAL_PATH_RE = /^\/portal(\/|$)/

/**
 * href が「社内向け＝相手先には押させないリンク」かどうか。
 *
 * 1. scheme が無ければ相対リンク＝社内向け(true)。判定は前後の空白・制御文字を
 *    除いて小文字化してから行う(大文字化・タブ挿入などの偽装があっても scheme を
 *    認識するため)。空文字は飛び先が無いので true。
 * 2. `appHost`(このアプリのホスト名)が渡されたときは、**同じホストの絶対URL**も
 *    社内向けとみなす。社内の人がアドレスバーからコピーして貼るのは
 *    `https://agentpm.app/<org>/project/<space>/wiki?page=…` の形で、相対リンクより
 *    むしろ多い。ただし `/portal/` 配下は相手先自身の画面なので押せるまま残す。
 */
export function isInternalMinutesHref(href: string, appHost?: string): boolean {
  const normalized = href.replace(/[\x00-\x1f\x7f\s]+/g, '').toLowerCase()
  if (normalized === '') return true
  if (!HREF_SCHEME_RE.test(normalized)) return true
  if (!appHost) return false
  if (!/^https?:/.test(normalized)) return false
  try {
    const url = new URL(href.trim())
    if (url.host.toLowerCase() !== appHost.toLowerCase()) return false
    return !PORTAL_PATH_RE.test(url.pathname)
  } catch {
    // 読めない絶対URLは触らない(押せるリンクのままにしても飛び先が無いだけ)
    return false
  }
}

/** inline 配列の中の内部リンクを、表示文字だけの text 列に展開する。 */
function stripInlineArray(items: readonly MinutesInlineContent[], appHost?: string): MinutesInlineContent[] {
  const out: MinutesInlineContent[] = []
  for (const item of items) {
    if (item.type === 'link' && isInternalMinutesHref(item.href, appHost)) {
      out.push(...item.content)
      continue
    }
    out.push(item)
  }
  return out
}

function stripTableCell(
  cell: MinutesInlineContent[] | MinutesTableCell,
  appHost?: string
): MinutesInlineContent[] | MinutesTableCell {
  if (Array.isArray(cell)) return stripInlineArray(cell, appHost)
  return { ...cell, content: stripInlineArray(cell.content, appHost) }
}

function stripTableRow(row: MinutesTableRow, appHost?: string): MinutesTableRow {
  return { cells: row.cells.map((cell) => stripTableCell(cell, appHost)) }
}

function stripBlock(block: MinutesBlock, appHost?: string): MinutesBlock {
  const next: MinutesBlock = { ...block }
  if (Array.isArray(block.content)) {
    next.content = stripInlineArray(block.content, appHost)
  } else if (block.content && block.content.type === 'tableContent') {
    next.content = {
      ...block.content,
      rows: block.content.rows.map((row) => stripTableRow(row, appHost)),
    }
  }
  if (block.children) {
    next.children = block.children.map((child) => stripBlock(child, appHost))
  }
  return next
}

/**
 * ブロック木を再帰的にたどり、内部リンクを取り除いた新しい木を返す(入力は書き換えない)。
 * `appHost` を渡すと、同じホストの絶対URLも内部リンクとして扱う。
 */
export function stripInternalLinks(blocks: readonly MinutesBlock[], appHost?: string): MinutesBlock[] {
  return blocks.map((block) => stripBlock(block, appHost))
}
