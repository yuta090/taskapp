/**
 * Wiki 本文の取り込み変換（Markdown / HTML → BlockNote ブロック JSON）。
 *
 * アプリの Wiki 画面（src/components/wiki/WikiEditor.tsx）は BlockNote のブロック配列を JSON 文字列で
 * 保存・表示する。JSON でない本文は表示時に捨てられ**空のページに見える**ため、CLI/MCP から受け取った
 * Markdown / HTML は保存前に必ず同じブロック形式へ変換する。
 *
 * ⚠ BlockNote 公式のサーバー変換（@blocknote/server-util）は使わない。@blocknote/react 経由で React を
 *   読み込むため、Next.js のサーバー（Vercel）では RSC 用の React に差し替えられて
 *   `createContext is not a function` で落ちる（本番で踏んだ）。ここでは DOM も React も要らない
 *   marked（Markdown 解析）と turndown（HTML → Markdown）だけで、ブロック JSON を組み立てる。
 *   出力は WikiEditor / プリセット(src/lib/presets)が使っているブロック形（id なしの PartialBlock）に合わせる。
 */

import { marked, Lexer, type Token, type Tokens } from 'marked'
import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'

export type WikiBodyFormat = 'markdown' | 'html' | 'blocks'

const HTML_HINT = /^\s*<(!doctype|html|body|div|p|h[1-6]|ul|ol|table|section|article|span|br|pre|b|strong|i|em)\b/i

/**
 * 折りたたみ（トグル）の見出し行に付ける、読む人には見えない目印。
 * `- <!--toggle-->題名` ＋ 字下げした中身が BlockNote の折りたたみ（toggleListItem）になる。
 * 議事録（src/lib/minutes/markdown.ts の TOGGLE_MARKER）と同じ文字にそろえる。別パッケージなので
 * import できないため、一致はテストで見張る。
 */
export const TOGGLE_MARKER = '<!--toggle-->'
const TOGGLE_TYPE = 'toggleListItem'

/**
 * ページ内の目次に置き換わる目印。1行で `<!--toc-->` と書く。
 * Wiki 画面の「/」メニューが挿す目次ブロックと同じ名前（src/lib/minutes/markdown.ts の
 * TOC_TYPE / TOC_MARKER）。別パッケージなので import できず、一致はテストで見張る。
 *
 * これが無かったあいだ、`wiki update --format markdown` で送った `<!--toc-->` は
 * HTML コメントとして黙って捨てられていた（2026-09-18）。
 */
export const TOC_MARKER = '<!--toc-->'
export const TOC_TYPE = 'tableOfContents'

/**
 * 行の色（背景色・文字色）。ブロックの直前の独立した1行に `<!--color:bg=red text=blue-->` と書く。
 * 議事録（src/lib/minutes/markdown.ts の MINUTES_BLOCK_COLORS / readColorMarker）と同じ約束で、
 * 色はすぐ次の1ブロックだけに効く。別パッケージなので import できず、一致はテストで見張る。
 */
export const BLOCK_COLORS = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'] as const
const COLOR_MARKER_RE = /^<!--color:(bg|text)=([a-z]+)(?: (bg|text)=([a-z]+))?-->\s*$/
const COLORABLE_TYPES = new Set(['paragraph', 'heading', 'bulletListItem', 'numberedListItem', 'checkListItem', 'toggleListItem', 'table'])
/**
 * marked は印の行を前後の項目から切り離して読むので、印は次の行の本文の頭へ、文字に出てこない目印として移し、
 * ブロックを組んだあとで取り出す。目印は私用領域の文字（本文から先に消すので、送られた文字とは混ざらない）
 */
const COLOR_OPEN = '\uE000'
const COLOR_CLOSE = '\uE001'
const COLOR_SENTINEL_RE = /^\uE000([^\uE001]{0,40})\uE001/
const FENCE_LINE_RE = /^\s*(`{3,}|~{3,})/
/** 印を移す先の行頭（字下げ・リストの印・チェック・折りたたみの印・見出し・表の左端）。ここまでは残して、その後ろに目印を挿す */
const LINE_HEAD_RE = new RegExp(
  `^(\\s*(?:(?:[-*+]|\\d{1,9}[.)])\\s+(?:\\[[ xX]\\]\\s+)?(?:${TOGGLE_MARKER})?|#{1,6}\\s+|\\|\\s*)?)`
)

function readColorMarker(line: string): Record<string, string> | null {
  const m = COLOR_MARKER_RE.exec(line.trim())
  if (!m || m[1] === m[3]) return null
  const props: Record<string, string> = {}
  for (const [key, value] of [[m[1], m[2]], [m[3], m[4]]]) {
    if (key === undefined) continue
    if (!(BLOCK_COLORS as readonly string[]).includes(value)) return null
    props[key === 'bg' ? 'backgroundColor' : 'textColor'] = value
  }
  return props
}

/** 色の印の行を、次の本文の行の頭の目印に置き換える。コードの中・色を持てない行（コード・画像・引用・HTML）の前の印は消すだけ */
function moveColorMarkers(md: string): string {
  const lines = md.split('\n')
  const out: string[] = []
  let fence: string | null = null
  let pending: string | null = null
  for (const line of lines) {
    const f = FENCE_LINE_RE.exec(line)?.[1]
    if (fence) {
      if (f && f[0] === fence[0] && f.length >= fence.length) fence = null
      out.push(line)
      continue
    }
    if (f) {
      fence = f
      pending = null
      out.push(line)
      continue
    }
    const props = readColorMarker(line)
    if (props) {
      pending = Object.entries(props).map(([k, v]) => `${k}=${v}`).join(' ')
      continue
    }
    if (pending !== null && line.trim() !== '') {
      const head = LINE_HEAD_RE.exec(line)?.[1] ?? ''
      const rest = line.slice(head.length)
      if (!/^(!\[|>|<)/.test(rest.trimStart()) || rest.startsWith(TOGGLE_MARKER)) {
        out.push(head + COLOR_OPEN + pending + COLOR_CLOSE + rest)
        pending = null
        continue
      }
      pending = null
    }
    out.push(line)
  }
  return out.join('\n')
}

/** ブロックの頭の目印を色の props に戻す。目印は（色を持てないブロックでも）必ず本文から外す */
function applyColorSentinels(list: Block[]): void {
  for (const b of list) {
    const first = firstText(b)
    const m = first ? COLOR_SENTINEL_RE.exec(first.text) : null
    if (first && m) {
      first.text = first.text.slice(m[0].length)
      if (COLORABLE_TYPES.has(b.type)) {
        const props: Record<string, unknown> = { ...(b.props ?? {}) }
        for (const pair of m[1].split(' ')) {
          const [k, v] = pair.split('=')
          props[k] = v
        }
        b.props = props
      }
    }
    if (b.children) applyColorSentinels(b.children)
  }
}

function firstText(b: Block): TextInline | undefined {
  const c = b.content as unknown
  let inl: unknown
  if (Array.isArray(c)) inl = c[0]
  else if (c && typeof c === 'object' && 'rows' in c) inl = (c as { rows: { cells: InlineContent[][] }[] }).rows[0]?.cells[0]?.[0]
  if (!inl || typeof inl !== 'object') return undefined
  const i = inl as InlineContent
  return i.type === 'text' ? i : i.content[0]
}

/** 罫線。`---` `***` `___` と `<hr>` のどれで書いても同じブロックにする */
const DIVIDER_TYPE = 'divider'

// 本文は API キーを持つ人なら誰でも送れるので、タグを探す正規表現は後戻りで時間が伸びない形にする
// （属性の長さに上限を付け、閉じは読み進めるだけで探す）。
/** `<details>` の開き（HTML の塊の先頭にあるときだけ折りたたみとして読む） */
const DETAILS_OPEN_RE = /^\s{0,3}<details\b[^>]{0,1000}>/i
const SUMMARY_OPEN_RE = /<summary\b[^>]{0,1000}>/i
/**
 * 折りたたみにする `<details>` の入れ子の深さの上限。これより深い分は文字として残す
 * （段ごとに中身を組み立て直すので、深さに比例して処理が増え、深すぎると呼び出しが溢れる）。
 */
const MAX_DETAILS_DEPTH = 16
let detailsDepth = 0

/** 本文の形式を推定する。JSON のブロック配列 → blocks / HTML らしければ html / それ以外 markdown */
export function detectWikiBodyFormat(body: string): WikiBodyFormat {
  const trimmed = body.trim()
  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (Array.isArray(parsed) && parsed.every((b) => b && typeof b === 'object' && 'type' in (b as object))) {
        return 'blocks'
      }
    } catch {
      // JSON ではない → 下の判定へ
    }
  }
  if (HTML_HINT.test(trimmed) && /<\/[a-z][a-z0-9]*>/i.test(trimmed)) return 'html'
  return 'markdown'
}

// ---- BlockNote 側の最小限の型（PartialBlock 相当） ----

export interface InlineStyles {
  bold?: boolean
  italic?: boolean
  code?: boolean
  strike?: boolean
}
export type InlineContent =
  | { type: 'text'; text: string; styles: InlineStyles }
  | { type: 'link'; href: string; content: { type: 'text'; text: string; styles: InlineStyles }[] }

type TextInline = Extract<InlineContent, { type: 'text' }>

export interface Block {
  type: string
  props?: Record<string, unknown>
  content?: InlineContent[] | { type: 'tableContent'; rows: { cells: InlineContent[][] }[] }
  children?: Block[]
}

// ---- inline ----

function text(t: string, styles: InlineStyles = {}): TextInline {
  return { type: 'text', text: t, styles }
}

/**
 * タグ（`<` ＋ 1文字以上 ＋ `>`）を外す。`/<[^>]+>/g` と同じ結果だが、閉じの `>` が無い `<` が並ぶと
 * 正規表現は `<` ごとに末尾まで探し直して時間が本文の長さの2乗に伸びるので、次の `>` を1回だけ探す。
 */
function stripTags(html: string): string {
  let out = ''
  let i = 0
  while (i < html.length) {
    const lt = html.indexOf('<', i)
    if (lt === -1) break
    const gt = html.indexOf('>', lt + 1)
    // これより後ろに `>` が無ければ、もうタグは無い
    if (gt === -1) break
    out += html.slice(i, lt)
    // `<>` はタグではない（中身が1文字以上要る）
    if (gt === lt + 1) {
      out += '<'
      i = lt + 1
    } else {
      i = gt + 1
    }
  }
  out += html.slice(i)
  return out.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
}

function inline(tokens: Token[] | undefined, styles: InlineStyles = {}): InlineContent[] {
  const out: InlineContent[] = []
  for (const tok of tokens ?? []) {
    switch (tok.type) {
      case 'text': {
        const t = tok as Tokens.Text
        if (t.tokens && t.tokens.length) out.push(...inline(t.tokens, styles))
        else out.push(text(t.text, styles))
        break
      }
      case 'escape':
        out.push(text((tok as Tokens.Escape).text, styles))
        break
      case 'strong':
        out.push(...inline((tok as Tokens.Strong).tokens, { ...styles, bold: true }))
        break
      case 'em':
        out.push(...inline((tok as Tokens.Em).tokens, { ...styles, italic: true }))
        break
      case 'del':
        out.push(...inline((tok as Tokens.Del).tokens, { ...styles, strike: true }))
        break
      case 'codespan':
        out.push(text((tok as Tokens.Codespan).text, { ...styles, code: true }))
        break
      case 'br':
        out.push(text('\n', styles))
        break
      case 'link': {
        const l = tok as Tokens.Link
        const inner = inline(l.tokens, styles).flatMap((c): TextInline[] => (c.type === 'text' ? [c] : c.content))
        out.push({ type: 'link', href: l.href, content: inner.length ? inner : [text(l.text || l.href, styles)] })
        break
      }
      case 'image':
        out.push(text((tok as Tokens.Image).text || (tok as Tokens.Image).href, styles))
        break
      case 'html':
        out.push(text(stripTags((tok as Tokens.HTML).text), styles))
        break
      default:
        if ('text' in tok && typeof (tok as { text?: unknown }).text === 'string') out.push(text((tok as { text: string }).text, styles))
    }
  }
  // 空テキストを落とし、連続する同スタイルを結合しない（表示上の差はない）
  return out.filter((c) => c.type === 'link' || c.text !== '')
}

/** 1行分の Markdown（太字・リンクなど）をインラインに読む。HTML タグとコメントは文字から外れる */
function inlineMarkdown(src: string): InlineContent[] {
  return inline(Lexer.lexInline(src, { gfm: true }))
}

// ---- block ----

function listBlocks(list: Tokens.List): Block[] {
  return list.items.map((item) => {
    let type = list.ordered ? 'numberedListItem' : 'bulletListItem'
    const content: InlineContent[] = []
    const children: Block[] = []
    // 子にするリスト以外のブロック。`<details>` が複数の塊に分かれていても組めるよう、まとめて変換する
    let pending: Token[] = []
    const flush = () => {
      if (pending.length) children.push(...blocks(pending))
      pending = []
    }
    // 項目の中に字下げして置いた `<details>` は、開きから対応する閉じまでの塊を丸ごと子へ回す。
    // 種類だけで振り分けると、中身の段落が折りたたみに届く前に項目の本文へ吸い込まれる
    const tokens = item.tokens
    const detailsCloses = detailsDepth < MAX_DETAILS_DEPTH ? pairDetails(tokens) : undefined
    let skipUntil = -1
    tokens.forEach((t, i) => {
      if (skipUntil >= i) return
      const close = detailsCloses?.get(i)
      if (close) {
        pending.push(...tokens.slice(i, close.token + 1))
        skipUntil = close.token
      } else if (t.type === 'list') {
        flush()
        children.push(...listBlocks(t as Tokens.List))
      } else if (t.type === 'text' || t.type === 'paragraph') {
        content.push(...inline((t as Tokens.Text).tokens ?? [t]))
      } else if (i === 0 && t.type === 'html' && !DETAILS_OPEN_RE.test(t.raw)) {
        // 1行目が `<!--…-->` などで始まると、marked はその行を HTML の塊として返す。
        // 子へ回すと本文が空になり題名が子に落ちるので、1行目の文字として読む
        let src = t.raw.replace(/\n+$/, '')
        if (!list.ordered && !item.task && src.startsWith(TOGGLE_MARKER)) {
          type = TOGGLE_TYPE
          src = src.slice(TOGGLE_MARKER.length)
        }
        content.push(...inlineMarkdown(src))
      } else {
        pending.push(t)
      }
    })
    flush()
    const base: Block = { type, content }
    if (item.task) return { ...base, type: 'checkListItem', props: { checked: !!item.checked }, children }
    return children.length ? { ...base, children } : base
  })
}

function tableBlock(t: Tokens.Table): Block {
  const rows: { cells: InlineContent[][] }[] = []
  rows.push({ cells: t.header.map((c) => inline(c.tokens, { bold: true })) })
  for (const r of t.rows) rows.push({ cells: r.map((c) => inline(c.tokens)) })
  return { type: 'table', content: { type: 'tableContent', rows } }
}

/** `<details>` の閉じの位置（どの塊の、何文字目から何文字目か） */
interface DetailsClose {
  token: number
  start: number
  end: number
}

/**
 * 塊の並びの中で、塊の先頭にある `<details>` の開きと、それに対応する `</details>` を結ぶ。
 * marked は `<details>` を「開き」「中身の段落」「閉じ」の別々の塊に分けて返すので、先頭から1回だけ
 * 読み進め、開きを積んで閉じで取り出す（入れ子も受ける）。閉じの無い開きは結ばない。
 * 開きごとに末尾まで探し直すと、閉じの無い開きが並んだ本文で時間が本文の長さの2乗に伸びる。
 */
function pairDetails(tokens: Token[]): Map<number, DetailsClose> {
  const closes = new Map<number, DetailsClose>()
  const opens: { token: number; atBlockStart: boolean }[] = []
  tokens.forEach((tok, j) => {
    if (tok.type !== 'html') return
    const blockOpenEnd = DETAILS_OPEN_RE.exec(tok.raw)?.[0].length ?? -1
    for (const m of tok.raw.matchAll(/<(\/?)details\b[^>]{0,1000}>/gi)) {
      const at = m.index ?? 0
      if (!m[1]) {
        opens.push({ token: j, atBlockStart: at + m[0].length === blockOpenEnd })
        continue
      }
      const open = opens.pop()
      if (open?.atBlockStart) closes.set(open.token, { token: j, start: at, end: at + m[0].length })
    }
  })
  return closes
}

/**
 * 文字列の先頭（空白の後）にある `<summary>…</summary>` を取り出す。先頭に無いもの（中身の奥の、
 * 入れ子の details の summary など）は題名にしない。閉じは読み進めて探す（後戻りしない）。
 */
function takeSummary(s: string): { title: string; rest: string } | null {
  const open = SUMMARY_OPEN_RE.exec(s)
  if (!open || s.slice(0, open.index).trim() !== '') return null
  const from = open.index + open[0].length
  const closeRe = /<\/summary\s{0,100}>/gi
  closeRe.lastIndex = from
  const close = closeRe.exec(s)
  if (!close) return null
  return { title: s.slice(from, close.index).trim(), rest: s.slice(close.index + close[0].length) }
}

/**
 * tokens[start] の `<details>` から close までを1つの折りたたみにする（題名＝summary・残り＝子）。
 * 間の塊は読み直さずにそのまま変換する。開きの塊の残りと閉じの塊の手前（空行を挟まずに書いた本文）だけ
 * 文字列として読む。
 */
function detailsBlock(tokens: Token[], start: number, close: DetailsClose): Block {
  const openRaw = tokens[start].raw
  const openEnd = DETAILS_OPEN_RE.exec(openRaw)?.[0].length ?? 0
  const sameToken = close.token === start
  let head = sameToken ? openRaw.slice(openEnd, close.start) : openRaw.slice(openEnd)
  let middle = sameToken ? [] : tokens.slice(start + 1, close.token)
  const tail = sameToken ? '' : tokens[close.token].raw.slice(0, close.start)

  // summary は開きと同じ塊にあることが多いが、空行を挟むと次の HTML の塊に分かれる
  let title = ''
  let afterSummary = ''
  const inHead = takeSummary(head)
  if (inHead) {
    title = inHead.title
    head = inHead.rest
  } else if (!head.trim() && middle[0]?.type === 'html') {
    const inNext = takeSummary(middle[0].raw)
    if (inNext) {
      title = inNext.title
      afterSummary = inNext.rest
      middle = middle.slice(1)
    }
  }

  const children: Block[] = []
  detailsDepth++
  try {
    for (const part of [head, afterSummary]) if (part.trim()) children.push(...parseMarkdown(part))
    children.push(...blocks(middle))
    if (tail.trim()) children.push(...parseMarkdown(tail))
  } finally {
    detailsDepth--
  }
  const block: Block = { type: TOGGLE_TYPE, content: inlineMarkdown(title) }
  return children.length ? { ...block, children } : block
}

/**
 * 画像の URL として置いてよいもの。アプリのファイル（`file upload` の link＝`/api/files/<id>/download`）と
 * https の画像だけ（http は CSP の img-src で表示されない）。手元のパス（`./shot.png`）は表示できない画像になるので、ブロックにせず文字で残す
 */
const IMAGE_URL_RE = /^(https:\/\/|\/(?!\/))/i

/**
 * 画像だけの行（`![図](url)`、並べて複数も可）を画像ブロックにする。文の途中の画像や
 * 置けない URL が混じる行は null（今までどおり段落として文字で残す）
 */
function imageBlocks(tokens: Token[]): Block[] | null {
  const images: Tokens.Image[] = []
  for (const t of tokens) {
    if (t.type === 'image' && IMAGE_URL_RE.test((t as Tokens.Image).href)) images.push(t as Tokens.Image)
    else if (!(t.type === 'text' && !(t as Tokens.Text).text.trim()) && t.type !== 'br') return null
  }
  if (images.length === 0) return null
  return images.map((img) => ({ type: 'image', props: { url: img.href, name: img.text } }))
}

const CALLOUT_TYPE = 'callout'
/** アラート記法の1行目。種類は callout の kind（5種類）に1対1で対応する。同じ行にほかの文字があれば囲みにしない */
const CALLOUT_HEAD_RE = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i

/**
 * 引用の1行目が `[!NOTE]` などなら囲みにする。2行目以降は引用の `>` を外して Markdown として読み直し、
 * 先頭が段落ならその文字を囲みの content に、残りを children にする（箇条書き・複数段落・見出し・コードも入る）。
 * アラートでない引用は null（呼び出し側が従来どおりイタリック段落にする）。
 */
function calloutBlock(tok: Tokens.Blockquote): Block | null {
  const lines = tok.raw.replace(/\n+$/, '').split('\n').map((l) => l.replace(/^ {0,3}>[ \t]?/, ''))
  const kind = CALLOUT_HEAD_RE.exec(lines[0])?.[1]
  if (!kind) return null
  const inner = lines.slice(1).join('\n')
  const parsed = inner.trim() ? parseMarkdown(inner) : []
  const head = parsed[0]?.type === 'paragraph' ? parsed.shift() : undefined
  const block: Block = { type: CALLOUT_TYPE, props: { kind: kind.toLowerCase() }, content: (head?.content as InlineContent[] | undefined) ?? [] }
  return parsed.length ? { ...block, children: parsed } : block
}

function blocks(tokens: Token[]): Block[] {
  const out: Block[] = []
  // 深すぎる入れ子の中では `<details>` を折りたたみにしない（文字として残す）
  const detailsCloses = detailsDepth < MAX_DETAILS_DEPTH ? pairDetails(tokens) : undefined
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]
    switch (tok.type) {
      case 'heading': {
        const h = tok as Tokens.Heading
        out.push({ type: 'heading', props: { level: Math.min(h.depth, 3) }, content: inline(h.tokens) })
        break
      }
      case 'paragraph': {
        const p = tok as Tokens.Paragraph
        out.push(...(imageBlocks(p.tokens) ?? [{ type: 'paragraph', content: inline(p.tokens) }]))
        break
      }
      case 'text':
        out.push({ type: 'paragraph', content: inline((tok as Tokens.Text).tokens ?? [tok]) })
        break
      case 'list':
        out.push(...listBlocks(tok as Tokens.List))
        break
      case 'code': {
        const c = tok as Tokens.Code
        out.push({ type: 'codeBlock', props: { language: c.lang || '' }, content: [text(c.text)] })
        break
      }
      case 'table':
        out.push(tableBlock(tok as Tokens.Table))
        break
      case 'blockquote': {
        // GitHub のアラート記法（`> [!NOTE]` など）は囲みにする
        const callout = calloutBlock(tok as Tokens.Blockquote)
        if (callout) {
          out.push(callout)
          break
        }
        // 引用はイタリック段落として平坦化する（BlockNote 既定スキーマに引用ブロックが無い）
        for (const b of blocks((tok as Tokens.Blockquote).tokens)) {
          if (Array.isArray(b.content)) b.content = b.content.map((c) => (c.type === 'text' ? { ...c, styles: { ...c.styles, italic: true } } : c))
          out.push(b)
        }
        break
      }
      case 'html': {
        const close = detailsCloses?.get(i)
        if (close) {
          out.push(detailsBlock(tokens, i, close))
          // 閉じと同じ塊で、空行を挟まずに続けて書いた本文
          const trailing = tokens[close.token].raw.slice(close.end)
          if (trailing.trim()) out.push(...parseMarkdown(trailing))
          i = close.token
          break
        }
        const raw = (tok as Tokens.HTML).text.trim()
        if (raw === TOC_MARKER) {
          out.push({ type: TOC_TYPE })
          break
        }
        if (/^<hr\s*\/?>$/i.test(raw)) {
          out.push({ type: DIVIDER_TYPE })
          break
        }
        const s = stripTags((tok as Tokens.HTML).text).trim()
        if (s) out.push({ type: 'paragraph', content: [text(s)] })
        break
      }
      case 'hr':
        out.push({ type: DIVIDER_TYPE })
        break
      case 'space':
        break
      default:
        if ('text' in tok && typeof (tok as { text?: unknown }).text === 'string' && (tok as { text: string }).text.trim()) {
          out.push({ type: 'paragraph', content: [text((tok as { text: string }).text)] })
        }
    }
  }
  return out
}

export function markdownToBlocks(md: string): Block[] {
  // 目印に使う文字は、送られた本文からは先に消す（本文の文字が色に化けないように）
  const out = parseMarkdown(md.replace(/[\uE000\uE001]/g, ''))
  applyColorSentinels(out)
  return out
}

/** 中で読み直す `<details>` の中身も通る。目印は最後に markdownToBlocks でまとめて色に戻す */
function parseMarkdown(md: string): Block[] {
  return blocks(marked.lexer(moveColorMarkers(md), { gfm: true }))
}

let turndown: TurndownService | null = null
export function htmlToMarkdown(html: string): string {
  if (!turndown) {
    turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' })
    turndown.use(gfm)
    // `<details>` は既定だと開閉が消えて題名と中身が段落になる。Markdown 側で折りたたみとして読める
    // 形（開き・summary・空行・中身・空行・閉じ）に書き直す。中身は子要素を変換した Markdown
    turndown.addRule('summary', { filter: 'summary', replacement: () => '' })
    turndown.addRule('details', {
      filter: 'details',
      replacement: (content, node) => {
        const kids = Array.from((node as unknown as { childNodes: ArrayLike<{ nodeName: string; textContent: string | null }> }).childNodes)
        const title = (kids.find((k) => k.nodeName === 'SUMMARY')?.textContent ?? '').replace(/\s+/g, ' ').trim()
        return `\n\n<details>\n<summary>${title}</summary>\n\n${content.trim()}\n\n</details>\n\n`
      },
    })
  }
  return turndown.turndown(html)
}

/**
 * 本文を Wiki 画面が読めるブロック JSON 文字列にする。
 * - 空文字はそのまま空
 * - format 未指定なら detectWikiBodyFormat で推定
 */
export async function toWikiBlocksJson(body: string, format?: WikiBodyFormat): Promise<string> {
  if (body.trim() === '') return ''
  const fmt = format ?? detectWikiBodyFormat(body)
  if (fmt === 'blocks') return body.trim()
  const md = fmt === 'html' ? htmlToMarkdown(body) : body
  return JSON.stringify(markdownToBlocks(md))
}
