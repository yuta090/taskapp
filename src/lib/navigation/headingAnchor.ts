/**
 * 見出しへのリンク（`…?page=<id>#<アンカー>`）の作り方と探し方。
 *
 * アンカーは**ブロックIDではなく見出しの文字から作る。** Wiki の本文は CLI から Markdown で
 * 丸ごと上書きされることが多く、そのたびにブロックIDが振り直される。IDで作ったリンクは
 * 上書きのたびに切れるが、見出しの文字が同じならアンカーは変わらない。
 *
 * 画面を持たない純粋な関数だけを置く（Wiki と議事録の両方から使う）。
 */

/** 見出しの1つ。`id` は BlockNote のブロックID（画面では `data-id` に出る） */
export interface HeadingAnchor {
  id: string
  level: number
  text: string
  anchor: string
}

/** 記号だけの見出しなど、文字が残らなかったときのアンカー */
const FALLBACK_ANCHOR = '見出し'

/**
 * 見出しの文字 → アンカー。
 *
 * - 前後の空白を除き、空白（全角を含む）の連続は `-` 1つにする
 * - 英字は小文字にする（GitHub の見出しリンクと同じ）
 * - 文字・数字・`-`・`_` 以外（句読点・括弧・`/` など）は消す。日本語はそのまま残す
 * - `-` の連続は1つにし、前後の `-` は落とす
 * - 濁点の分かれた入力でも同じになるよう NFC にそろえる
 */
export function slugifyHeading(text: string): string {
  const slug = text
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || FALLBACK_ANCHOR
}

/** BlockNote のブロックのうち、ここで読むところだけ */
interface BlockLike {
  id?: string
  type?: string
  props?: { level?: unknown }
  content?: unknown
  children?: unknown
}

function inlineText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .map((c) => {
      if (!c || typeof c !== 'object') return ''
      const node = c as { type?: string; text?: string; content?: unknown }
      if (typeof node.text === 'string') return node.text
      if (node.type === 'link') return inlineText(node.content)
      return ''
    })
    .join('')
}

/**
 * 本文から見出しを上から順に拾い、アンカーを振る。字下げした子ブロックの中も見る。
 * 同じアンカーが2つ目以降に出たら `-2` `-3` を付ける（すでに使われていれば次の番号）。
 */
export function collectHeadingAnchors(blocks: readonly unknown[] | undefined): HeadingAnchor[] {
  const out: HeadingAnchor[] = []
  const used = new Set<string>()
  const seen = new Map<string, number>()

  const visit = (list: unknown) => {
    if (!Array.isArray(list)) return
    for (const raw of list) {
      if (!raw || typeof raw !== 'object') continue
      const b = raw as BlockLike
      if (b.type === 'heading' && typeof b.id === 'string') {
        const text = inlineText(b.content).trim()
        if (text) {
          const base = slugifyHeading(text)
          let n = seen.get(base) ?? 0
          let anchor = n === 0 ? base : `${base}-${n + 1}`
          while (used.has(anchor)) {
            n += 1
            anchor = `${base}-${n + 1}`
          }
          seen.set(base, n + 1)
          used.add(anchor)
          const level = Math.min(Math.max(Number(b.props?.level) || 1, 1), 6)
          out.push({ id: b.id, level, text, anchor })
        }
      }
      visit(b.children)
    }
  }
  visit(blocks)
  return out
}

/**
 * `#` の値から見出しのブロックIDを探す。見つからなければ null。
 *
 * 1. アンカーがそのまま一致するもの
 * 2. 見出しの文字をそのまま書いた `#`（アンカーに直すと一致するもの）
 * 3. ブロックID（アンカーを入れる前に作られたリンクのため）
 */
export function findHeadingIdByHash(anchors: readonly HeadingAnchor[], hash: string): string | null {
  const raw = hash.replace(/^#/, '')
  if (!raw) return null
  let value: string
  try {
    value = decodeURIComponent(raw)
  } catch {
    value = raw
  }
  value = value.normalize('NFC')

  const exact = anchors.find((h) => h.anchor === value)
  if (exact) return exact.id

  if (/[\p{L}\p{N}]/u.test(value)) {
    const slug = slugifyHeading(value)
    const bySlug = anchors.find((h) => h.anchor === slug)
    if (bySlug) return bySlug.id
  }

  const byId = anchors.find((h) => h.id === value)
  return byId ? byId.id : null
}

/** URL に残すクエリ。どのページ・どの会議かを指すものだけ（info=1 などの表示状態は落とす） */
const KEPT_QUERY_KEYS = ['page', 'meeting'] as const

/** 見出しへの URL。`origin + pathname + (page= / meeting=) + '#' + アンカー` */
export function buildHeadingUrl(
  loc: { origin: string; pathname: string; search: string },
  anchor: string
): string {
  const current = new URLSearchParams(loc.search)
  const kept = new URLSearchParams()
  for (const key of KEPT_QUERY_KEYS) {
    const v = current.get(key)
    if (v) kept.set(key, v)
  }
  const query = kept.toString()
  return `${loc.origin}${loc.pathname}${query ? `?${query}` : ''}#${encodeURIComponent(anchor)}`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * クリップボードに入れる2つの形。
 * - text/plain: `<ページ名> §<見出し>` と URL の2行（タスクの説明文に貼ると URL がリンクになる）
 * - text/html: 同じ文字のリンク（Slack・メールなど書式を受け取る所に貼る用）
 */
export function buildHeadingClipboard(input: {
  pageTitle: string
  headingText: string
  url: string
}): { plain: string; html: string } {
  const title = input.pageTitle.trim()
  const label = title ? `${title} §${input.headingText}` : `§${input.headingText}`
  return {
    plain: `${label}\n${input.url}`,
    html: `<a href="${escapeHtml(input.url)}">${escapeHtml(label)}</a>`,
  }
}
