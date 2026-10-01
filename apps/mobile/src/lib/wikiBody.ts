/**
 * Wiki ページの本文（`wiki_pages.body`）を、スマホの画面が描くブロックの列にする（純粋関数）。
 *
 * 本文は Markdown ではなく **BlockNote のブロック配列を JSON.stringify した文字列**
 * （Web の WikiEditor が保存する形。src/lib/wiki/useWikiBodySave.ts・src/components/wiki/WikiEditor.tsx）。
 * 読むだけなので、編集に要る属性（色・幅・id）は落とし、見た目に要るものだけ残す。
 *
 * - 対応: 見出し・段落・箇条書き（入れ子）・番号付き・チェック・折りたたみ・引用・コード・区切り線・表
 * - Web で開いてもらう: 会議一覧・投票・差し込み・目次・会議メモ・画像などのファイル類（1行の案内）
 * - 知らない型でも、中身の文字は段落として出す（本文を落とさない）
 * - JSON として読めない本文は、全文を1つの段落にして文字で出す（HTML も文字のまま）
 */

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
  | { type: 'notice'; message: string; children: WikiBlock[] }

export const WEB_ONLY_MESSAGE = 'この部分は Web で開いてください'

/** スマホでは描けないブロックの型（Web の独自ブロックと、画像などのファイル類） */
const WEB_ONLY_TYPES = new Set([
  'meetingsList',
  'docPoll',
  'docInsertion',
  'tableOfContents',
  'meetingNote',
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

function blocksOf(raws: unknown, depth: number): WikiBlock[] {
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
    const children = blocksOf(raw.children, depth + 1)
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

/** 本文（BlockNote の JSON 文字列）を画面用のブロック列にする。空・null は空の配列 */
export function parseWikiBody(body: string | null): WikiBlock[] {
  if (body == null || body.trim() === '') return []
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    parsed = undefined
  }
  if (Array.isArray(parsed) && parsed.every(isRawBlock)) return blocksOf(parsed, 0)
  // JSON として読めない本文（古い形式など）は、全文を文字のまま1つの段落で出す
  return [{ type: 'paragraph', spans: [{ text: body }], children: [] }]
}
