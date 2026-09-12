/**
 * ただの文字（タスクの説明文など）の中から、押せるリンクにしてよい所を拾う。
 *
 * 拾いすぎると事故る。`9/13` のような日付や `A/B` までリンクになってしまうので、
 * アプリの中のリンクは **`appLinks.ts` が作る形だけ**を認める。
 * 形を増やすときは `appLinks.ts` と両方そろえる（`DOC_LINK_SPEC.md`）。
 */

/** リンクの種類。開き方が違う */
export type LinkPartKind = 'text' | 'app' | 'download' | 'external'

export interface LinkPart {
  kind: LinkPartKind
  /** 画面に出す文字 */
  value: string
  /** 飛び先。kind が 'text' のときは無い */
  href?: string
}

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'

/**
 * 拾う形（この順に試す）。
 *
 * **この定数に `test()` / `exec()` を使わないこと。** `matchAll` は正規表現を複製して回すので
 * `lastIndex` を持ち越さないが、`test()` を1回でも呼ぶと `lastIndex` が進んだまま複製され、
 * 以降 `matchAll` が何も拾わなくなる（例外は出ず、全部ただの文字に戻るので気づきにくい）。
 *
 * 1. `https://…` / `http://…`
 * 2. `/api/files/<uuid>/download`
 * 3. `/<uuid>/project/<uuid>` （＋ `/wiki` `/meetings` ＋ `?key=value`）
 */
const LINK_RE = new RegExp(
  [
    'https?://[^\\s<>"）」』]+',
    `/api/files/${UUID}/download`,
    `/${UUID}/project/${UUID}(?:/(?:wiki|meetings))?(?:\\?[A-Za-z_]+=${UUID})?`,
  ].join('|'),
  'g'
)

/** URL の後ろに付いてきた句読点・閉じ括弧は、リンクの一部にしない */
const TRAILING = /[.,;:!?。、）)\]」』]+$/

function classify(href: string): LinkPartKind {
  if (href.startsWith('http')) return 'external'
  if (href.startsWith('/api/files/')) return 'download'
  return 'app'
}

/**
 * 文字列を「ただの文字」と「リンク」に分ける。順番は元のまま。
 * 改行や空白はそのまま残すので、`whitespace-pre-wrap` で今までどおりに見える。
 */
export function splitTextIntoLinkParts(text: string): LinkPart[] {
  if (!text) return []

  const parts: LinkPart[] = []
  let lastIndex = 0

  for (const match of text.matchAll(LINK_RE)) {
    const start = match.index ?? 0
    let href = match[0]

    // 「（https://example.com/a）。」のような書き方で、閉じ括弧まで飲み込まないようにする
    const trimmed = href.replace(TRAILING, '')
    const dropped = href.length - trimmed.length
    href = trimmed

    if (start > lastIndex) {
      parts.push({ kind: 'text', value: text.slice(lastIndex, start) })
    }
    parts.push({ kind: classify(href), value: href, href })
    lastIndex = start + match[0].length - dropped
  }

  if (lastIndex < text.length) {
    parts.push({ kind: 'text', value: text.slice(lastIndex) })
  }
  return parts
}
