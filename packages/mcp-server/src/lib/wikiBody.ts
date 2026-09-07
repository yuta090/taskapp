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

import { marked, type Token, type Tokens } from 'marked'
import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'

export type WikiBodyFormat = 'markdown' | 'html' | 'blocks'

const HTML_HINT = /^\s*<(!doctype|html|body|div|p|h[1-6]|ul|ol|table|section|article|span|br|pre|b|strong|i|em)\b/i

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

// ---- block ----

function listBlocks(list: Tokens.List): Block[] {
  return list.items.map((item) => {
    const contentTokens: Token[] = []
    const children: Block[] = []
    for (const t of item.tokens) {
      if (t.type === 'list') children.push(...listBlocks(t as Tokens.List))
      else if (t.type === 'text' || t.type === 'paragraph') contentTokens.push(...((t as Tokens.Text).tokens ?? [t]))
      else children.push(...blocks([t]))
    }
    const base: Block = { type: list.ordered ? 'numberedListItem' : 'bulletListItem', content: inline(contentTokens) }
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

function blocks(tokens: Token[]): Block[] {
  const out: Block[] = []
  for (const tok of tokens) {
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
