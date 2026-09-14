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

/** `<details>` の開き（HTML の塊の先頭にあるときだけ折りたたみとして読む） */
const DETAILS_OPEN_RE = /^\s*<details\b[^>]*>/i
const SUMMARY_RE = /<summary\b[^>]*>([\s\S]*?)<\/summary\s*>/i

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

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
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
    item.tokens.forEach((t, i) => {
      if (t.type === 'list') {
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

/** `<details>` の中身（開きの直後〜対応する閉じの直前）を折りたたみにする。題名＝summary・残り＝子 */
function toggleFromDetails(inner: string): Block {
  const m = SUMMARY_RE.exec(inner)
  const title = m ? m[1].trim() : ''
  const body = m ? inner.slice(0, m.index) + inner.slice(m.index + m[0].length) : inner
  const children = body.trim() ? markdownToBlocks(body) : []
  const block: Block = { type: TOGGLE_TYPE, content: inlineMarkdown(title) }
  return children.length ? { ...block, children } : block
}

/**
 * tokens[start] が `<details>` で始まる HTML の塊のとき、対応する `</details>` までを1つの折りたたみにする。
 * marked は `<details>` を「開き」「中身の段落」「閉じ」の別々の塊に分けて返すので、開きと閉じを数えて
 * 対応を取る（入れ子も受ける）。閉じの後ろに同じ塊で続く文字は trailing で返す。
 * 閉じが無いときは null（呼び出し側は今までどおり文字として扱い、本文を隠さない）。
 */
function takeDetails(tokens: Token[], start: number): { toggle: Block; trailing: string; next: number } | null {
  let depth = 1
  let inner = ''
  for (let j = start; j < tokens.length; j++) {
    const raw = j === start ? tokens[j].raw.replace(DETAILS_OPEN_RE, '') : tokens[j].raw
    if (tokens[j].type !== 'html') {
      inner += raw
      continue
    }
    const tagRe = /<(\/?)details\b[^>]*>/gi
    let m: RegExpExecArray | null
    while ((m = tagRe.exec(raw))) {
      depth += m[1] ? -1 : 1
      if (depth === 0) {
        return {
          toggle: toggleFromDetails(inner + raw.slice(0, m.index)),
          trailing: raw.slice(m.index + m[0].length),
          next: j + 1,
        }
      }
    }
    inner += raw
  }
  return null
}

function blocks(tokens: Token[]): Block[] {
  const out: Block[] = []
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]
    switch (tok.type) {
      case 'heading': {
        const h = tok as Tokens.Heading
        out.push({ type: 'heading', props: { level: Math.min(h.depth, 3) }, content: inline(h.tokens) })
        break
      }
      case 'paragraph':
        out.push({ type: 'paragraph', content: inline((tok as Tokens.Paragraph).tokens) })
        break
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
      case 'blockquote':
        // 引用はイタリック段落として平坦化する（BlockNote 既定スキーマに引用ブロックが無い）
        for (const b of blocks((tok as Tokens.Blockquote).tokens)) {
          if (Array.isArray(b.content)) b.content = b.content.map((c) => (c.type === 'text' ? { ...c, styles: { ...c.styles, italic: true } } : c))
          out.push(b)
        }
        break
      case 'html': {
        const details = DETAILS_OPEN_RE.test(tok.raw) ? takeDetails(tokens, i) : null
        if (details) {
          out.push(details.toggle)
          if (details.trailing.trim()) out.push(...markdownToBlocks(details.trailing))
          i = details.next - 1
          break
        }
        const s = stripTags((tok as Tokens.HTML).text).trim()
        if (s) out.push({ type: 'paragraph', content: [text(s)] })
        break
      }
      case 'hr':
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
  const tokens = marked.lexer(md, { gfm: true })
  return blocks(tokens)
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
