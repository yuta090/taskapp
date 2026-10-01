/**
 * Wiki ページの本文（`wiki_pages.body`）を、スマホの画面が描くブロックの列にする（純粋関数）。
 *
 * 本文は Markdown ではなく **BlockNote のブロック配列を JSON.stringify した文字列**
 * （Web の WikiEditor が保存する形。src/lib/wiki/useWikiBodySave.ts・src/components/wiki/WikiEditor.tsx）。
 * 読むだけなので、編集に要る属性（色・幅・id）は落とし、見た目に要るものだけ残す。
 *
 * - 対応: 見出し・段落・箇条書き（入れ子）・番号付き・チェック・折りたたみ・引用・コード・区切り線・表
 * - 利用者の文字を持つ独自ブロック（会議メモ・相手先の書き足し・投票）は、文字と書いた人・日時を出す
 *   （投票は議題の文字に「投票は Web で」を添える）
 * - Web で開いてもらう: 会議一覧・目次・画像などのファイル類（文字を持たないもの。1行の案内）
 * - 知らない型でも、中身の文字は段落として出す（本文を落とさない）
 * - JSON として読めない本文は、全文を1つの段落にして文字で出す（HTML も文字のまま）
 */
import { formatNoteStampLabel, normalizeNoteAuthor } from '@/lib/minutes/noteStamp'

/** 1かたまりの文字。書式とリンク先を持つ */
export interface WikiSpan {
  text: string
  bold?: true
  italic?: true
  strike?: true
  code?: true
  /** 開いてよいリンク先だけ入る（http/https、または Web 内の `/` で始まるパス） */
  href?: string
}

export type WikiBlock =
  | { type: 'heading'; level: 1 | 2 | 3; spans: WikiSpan[]; children: WikiBlock[] }
  | { type: 'paragraph'; spans: WikiSpan[]; children: WikiBlock[] }
  | { type: 'bullet'; spans: WikiSpan[]; children: WikiBlock[] }
  | { type: 'numbered'; number: number; spans: WikiSpan[]; children: WikiBlock[] }
  | { type: 'check'; checked: boolean; spans: WikiSpan[]; children: WikiBlock[] }
  | { type: 'toggle'; spans: WikiSpan[]; children: WikiBlock[] }
  | { type: 'quote'; spans: WikiSpan[]; children: WikiBlock[] }
  | { type: 'code'; text: string; language: string }
  | { type: 'divider' }
  /** 行 → 列 → 文字のかたまり */
  | { type: 'table'; rows: WikiSpan[][][] }
  /**
   * 会議メモ・相手先の書き足し・投票。利用者が書いた文字を持つので、案内に置き換えず文字を出す。
   * band は帯（会議メモの背景）をつけるか、byline は「書いた人 · 日時」（無ければ空文字）、
   * webNote は文字のあとに添える案内（投票だけ）
   */
  | { type: 'memo'; band: boolean; label: string | null; spans: WikiSpan[]; byline: string; webNote: string | null; children: WikiBlock[] }
  | { type: 'notice'; message: string; children: WikiBlock[] }

export const WEB_ONLY_MESSAGE = 'この部分は Web で開いてください'

export const POLL_WEB_NOTE = '投票は Web で'

/** スマホでは描けないブロックの型（文字を持たない Web の独自ブロックと、画像などのファイル類） */
const WEB_ONLY_TYPES = new Set([
  'meetingsList',
  'tableOfContents',
  'image',
  'video',
  'audio',
  'file',
])

/** 入れ子の深さの上限。これより深い部分は案内にする（極端な本文で呼び出しが溢れないように） */
const MAX_DEPTH = 32

type Json = Record<string, unknown>

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isRawBlock(v: unknown): v is Json {
  return isObject(v) && typeof v.type === 'string'
}

/**
 * 開いてよいリンク先だけ返す。http/https と、Web 内のパス（`/` で始まり `//` ではないもの）。
 * javascript: など、それ以外は開かない（許可するものを数え上げる形にしている）。
 */
export function safeLinkHref(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const s = value.trim()
  // 制御文字を挟んだ偽装（java\tscript: など）は許可の形に当たらないが、念のため先に弾く
  if (s === '' || /[\u0000-\u001f\u007f]/.test(s)) return undefined
  if (/^https?:\/\/\S/i.test(s)) return s
  if (/^\/(?![/\\])/.test(s)) return s
  return undefined
}

type Styles = Pick<WikiSpan, 'bold' | 'italic' | 'strike' | 'code'>

function stylesOf(raw: unknown, base: Styles): Styles {
  const out: Styles = { ...base }
  if (isObject(raw)) {
    if (raw.bold === true) out.bold = true
    if (raw.italic === true) out.italic = true
    if (raw.strike === true) out.strike = true
    if (raw.code === true) out.code = true
  }
  return out
}

function spansOf(content: unknown, base: Styles = {}, href?: string): WikiSpan[] {
  if (!Array.isArray(content)) return []
  const out: WikiSpan[] = []
  for (const item of content) {
    if (!isObject(item)) continue
    if (item.type === 'text') {
      if (typeof item.text !== 'string' || item.text === '') continue
      out.push({ text: item.text, ...stylesOf(item.styles, base), ...(href ? { href } : {}) })
    } else if (item.type === 'link') {
      out.push(...spansOf(item.content, base, safeLinkHref(item.href) ?? href))
    } else if (Array.isArray(item.content)) {
      // 知らない種類のインラインでも、中に文字があれば出す
      out.push(...spansOf(item.content, base, href))
    }
  }
  return out
}

function plainText(spans: WikiSpan[]): string {
  return spans.map((s) => s.text).join('')
}

function headingLevel(v: unknown): 1 | 2 | 3 {
  const n = typeof v === 'number' ? Math.trunc(v) : 1
  return n <= 1 ? 1 : n >= 3 ? 3 : 2
}

/** 表のセル。BlockNote の新しい形（`{ type: 'tableCell', content }`）と、CLI から入った形（インラインの配列そのもの）の両方 */
function cellSpans(cell: unknown): WikiSpan[] {
  if (Array.isArray(cell)) return spansOf(cell)
  if (isObject(cell)) return spansOf(cell.content)
  return []
}

function tableRows(content: unknown): WikiSpan[][][] {
  if (!isObject(content) || content.type !== 'tableContent' || !Array.isArray(content.rows)) return []
  return content.rows.map((row) => {
    const cells = isObject(row) && Array.isArray(row.cells) ? row.cells : []
    return cells.map(cellSpans)
  })
}

/** 書いた人と日時（Web の会議メモと同じ整え方）。どちらも無ければ空文字 */
function bylineOf(props: Json, today: Date): string {
  const author = normalizeNoteAuthor(typeof props.author === 'string' ? props.author : '')
  const stamp = formatNoteStampLabel(typeof props.createdAt === 'string' ? props.createdAt : undefined, today)
  return [author, stamp].filter(Boolean).join(' · ')
}

function blocksOf(raws: unknown, depth: number, today: Date): WikiBlock[] {
  if (!Array.isArray(raws)) return []
  const list = raws.filter(isRawBlock)
  if (depth > MAX_DEPTH) {
    return list.length > 0 ? [{ type: 'notice', message: WEB_ONLY_MESSAGE, children: [] }] : []
  }
  const out: WikiBlock[] = []
  // 番号付きは、連続する間だけ数える（間に別のブロックが入ったら 1 から）
  let run = 0
  for (const raw of list) {
    const props = isObject(raw.props) ? raw.props : {}
    const spans = spansOf(raw.content)
    const children = blocksOf(raw.children, depth + 1, today)
    if (raw.type === 'numberedListItem') {
      run = run === 0 && typeof props.start === 'number' ? Math.trunc(props.start) : run + 1
      out.push({ type: 'numbered', number: run, spans, children })
      continue
    }
    run = 0
    switch (raw.type) {
      case 'heading':
        out.push({ type: 'heading', level: headingLevel(props.level), spans, children })
        break
      case 'paragraph':
        out.push({ type: 'paragraph', spans, children })
        break
      case 'bulletListItem':
        out.push({ type: 'bullet', spans, children })
        break
      case 'checkListItem':
        out.push({ type: 'check', checked: props.checked === true, spans, children })
        break
      case 'toggleListItem':
        out.push({ type: 'toggle', spans, children })
        break
      case 'quote':
        out.push({ type: 'quote', spans, children })
        break
      case 'codeBlock':
        out.push({ type: 'code', text: plainText(spans), language: typeof props.language === 'string' ? props.language : '' })
        break
      case 'divider':
        out.push({ type: 'divider' })
        break
      case 'table':
        out.push({ type: 'table', rows: tableRows(raw.content) })
        break
      case 'meetingNote':
        out.push({ type: 'memo', band: true, label: null, spans, byline: bylineOf(props, today), webNote: null, children })
        break
      case 'docInsertion':
        out.push({
          type: 'memo',
          band: props.kind === 'meeting_note',
          label: null,
          spans,
          byline: bylineOf(props, today),
          webNote: null,
          children,
        })
        break
      case 'docPoll':
        out.push({
          type: 'memo',
          band: false,
          label: props.reasonRequired === 'ng_hold' ? '投票（理由必須）' : '投票',
          spans,
          byline: '',
          webNote: POLL_WEB_NOTE,
          children,
        })
        break
      default:
        if (WEB_ONLY_TYPES.has(raw.type as string)) {
          out.push({ type: 'notice', message: WEB_ONLY_MESSAGE, children })
        } else if (spans.length > 0) {
          out.push({ type: 'paragraph', spans, children })
        } else {
          // 文字を持たない知らない型。中の子だけは落とさない
          out.push(...children)
        }
    }
  }
  return out
}

/**
 * 本文（BlockNote の JSON 文字列）を画面用のブロック列にする。空・null は空の配列。
 * today は「同じ年なら日時に年を付けない」判定の基準（既定は今）
 */
export function parseWikiBody(body: string | null, today: Date = new Date()): WikiBlock[] {
  if (body == null || body.trim() === '') return []
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    parsed = undefined
  }
  if (Array.isArray(parsed) && parsed.every(isRawBlock)) return blocksOf(parsed, 0, today)
  // JSON として読めない本文（古い形式など）は、全文を文字のまま1つの段落で出す
  return [{ type: 'paragraph', spans: [{ text: body }], children: [] }]
}

// ---- 表の列幅 ----

/** 半角1文字ぶんの幅（文字の大きさ 14 に対しておおよそ） */
const CHAR_UNIT = 8
/** セルの左右の余白と罫線のぶん */
const CELL_CHROME = 20
const MIN_COLUMN_WIDTH = 72
const MAX_COLUMN_WIDTH = 240

/** 全角（日本語など）は半角の2文字ぶんとして数える */
function widthUnits(line: string): number {
  let units = 0
  for (const ch of line) {
    const code = ch.codePointAt(0) ?? 0
    units += code >= 0x1100 && !(code >= 0xff61 && code <= 0xff9f) ? 2 : 1
  }
  return units
}

/**
 * 表の列ごとの幅（pt）。その列でいちばん長いセルの文字数から決め、下限・上限に収める。
 * 上限を超える長いセルは、セルの中で折り返す。
 */
export function tableColumnWidths(rows: WikiSpan[][][]): number[] {
  const columns = rows.reduce((max, row) => Math.max(max, row.length), 0)
  const widths: number[] = []
  for (let k = 0; k < columns; k++) {
    let longest = 0
    for (const row of rows) {
      const text = plainText(row[k] ?? [])
      for (const line of text.split('\n')) longest = Math.max(longest, widthUnits(line))
    }
    widths.push(Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, longest * CHAR_UNIT + CELL_CHROME)))
  }
  return widths
}
