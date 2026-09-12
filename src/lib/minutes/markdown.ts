/**
 * 議事録 Markdown ⇄ BlockNote ブロックの決定的な自前変換。
 *
 * 議事録は `meetings.minutes_md`（Markdown）が正本。読み手は Web・AI/CLI（MCP の
 * minutes_get/update/append）・DB の議事録→タスク化 RPC（`rpc_parse_meeting_minutes` /
 * `rpc_get_minutes_preview`）・相手先ポータルと幅広い。Wiki 編集で使っている BlockNote
 * （`@blocknote/core` v0.46.2）を議事録編集にも使うが、BlockNote 標準の
 * `blocksToMarkdownLossy` は箇条書きを `* ` にし `<!--task:uuid-->` を消してしまうため
 * 使えない（実測済み）。ここでは DOM・React・BlockNote を一切 import しない純関数で、
 * DB 側の正規表現（下の SPEC_LINE_REGEX / TASK_MARKER_REGEX）と結合できる形を保つ。
 *
 * 文法は最小限（見出し1-3・箇条書き・チェック・番号付き・GFM表・フェンス・太字/斜体/
 * 取り消し線/インラインコード・リンク・素のURL・行末タスク目印）。それ以外の入力は
 * 「段落＋生テキスト」として文字を落とさずに保持する。
 */

// ---- 型 ----

export interface MinutesInlineStyles {
  bold?: boolean
  italic?: boolean
  strike?: boolean
  code?: boolean
}

export interface MinutesTextInline {
  type: 'text'
  text: string
  styles: MinutesInlineStyles
}

export interface MinutesLinkInline {
  type: 'link'
  href: string
  content: MinutesTextInline[]
}

/** カスタム inline: 議事録タスク化の目印（`<!--task:uuid-->`）。content を持たない。 */
export const TASK_MARKER_TYPE = 'taskMarker' as const

export interface MinutesTaskMarkerInline {
  type: typeof TASK_MARKER_TYPE
  props: { taskId: string }
}

export type MinutesInlineContent = MinutesTextInline | MinutesLinkInline | MinutesTaskMarkerInline

export interface MinutesTableCell {
  type: 'tableCell'
  props?: Record<string, unknown>
  content: MinutesInlineContent[]
}

export interface MinutesTableRow {
  cells: (MinutesInlineContent[] | MinutesTableCell)[]
}

export interface MinutesTableContent {
  type: 'tableContent'
  columnWidths: (number | undefined)[]
  headerRows: number
  rows: MinutesTableRow[]
}

export interface MinutesBlock {
  type: string
  props?: Record<string, unknown>
  content?: MinutesInlineContent[] | MinutesTableContent
  children?: MinutesBlock[]
}

// ---- DB 側（SQL）と結合する正規表現。SQL 側の定義と完全に一致させること ----

/**
 * `supabase/migrations/20240206_000_minutes_parser.sql` の
 * `v_line ~ '^-\s*\[\s*\]\s*SPEC\([^)]+\):\s*.+$'` と同一パターン。
 */
export const SPEC_LINE_REGEX = /^-\s*\[\s*\]\s*SPEC\([^)]+\):\s*.+$/

/**
 * 同マイグレーションの `v_line ~ '<!--task:[^>]+-->\s*$'` と同一パターン。
 */
export const TASK_MARKER_REGEX = /<!--task:([^>]+)-->\s*$/

// ---- 行レベルの文法パターン ----

const FENCE_RE = /^```(\S*)\s*$/
const HEADING_RE = /^(#{1,3})[ \t]+(.*)$/
const CHECK_RE = /^[-*+][ \t]+\[([ xX])\][ \t]*(.*)$/
const BULLET_RE = /^[-*+][ \t]+(.*)$/
const NUMBERED_RE = /^(\d+)\.[ \t]+(.*)$/
const TABLE_SEP_RE = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/

/**
 * 素のURL(裸で書ける http(s) URL)として許す文字。空白・山括弧に加え、この文法で
 * 特別な意味を持つ記号 (`()*~\`[]\`) も除く。これらを含む URL を裸のまま埋め込むと、
 * 隣接する `*` 等と結合して再解析のたびに構造が変わってしまう(実際に踏んだ不安定化)。
 * その場合でも `[text](href)` の明示リンクとしては書ける。
 */
const BARE_URL_RE = /^https?:\/\/[^\s<>()*~`[\]\\]+/

/**
 * この形に一致する行は、段落の生テキストとして書くと別のブロックに化けてしまう。
 * 先頭の半角スペースも対象（字下げと誤読され、意図しない子リスト/はぐれ行になるため）。
 */
function matchesBlockTrigger(line: string): boolean {
  return (
    FENCE_RE.test(line) ||
    HEADING_RE.test(line) ||
    CHECK_RE.test(line) ||
    BULLET_RE.test(line) ||
    NUMBERED_RE.test(line) ||
    /^\|/.test(line) ||
    /^<!--/.test(line) ||
    /^ /.test(line)
  )
}

function lineIndentLevel(line: string): number {
  const m = /^( *)/.exec(line)
  const spaces = m ? m[1].length : 0
  return Math.floor(spaces / 2)
}

function stripIndent(line: string, level: number): string {
  return line.slice(level * 2)
}

// ---- inline 文字エスケープ ----

/** 文字としての `*` `` ` `` `~` `\` をバックスラッシュで逃がす（順序: \ を最初に）。 */
function escapeText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\*/g, '\\*').replace(/`/g, '\\`').replace(/~/g, '\\~')
}

const ESCAPABLE_INLINE_CHARS = new Set(['\\', '*', '`', '~'])

function findUnescapedChar(raw: string, from: number, ch: string): number {
  let k = from
  while (k < raw.length) {
    if (raw[k] === '\\') {
      k += 2
      continue
    }
    if (raw[k] === ch) return k
    k++
  }
  return -1
}

function findUnescapedSeq(raw: string, from: number, seq: string): number {
  let k = from
  while (k <= raw.length - seq.length) {
    if (raw[k] === '\\') {
      k += 2
      continue
    }
    if (raw.startsWith(seq, k)) return k
    k++
  }
  return -1
}

function findUnescapedSingleStar(raw: string, from: number): number {
  let k = from
  while (k < raw.length) {
    if (raw[k] === '\\') {
      k += 2
      continue
    }
    if (raw[k] === '*') {
      if (raw[k + 1] === '*') {
        k += 2
        continue
      }
      return k
    }
    k++
  }
  return -1
}

function addStyle(item: MinutesInlineContent, style: keyof MinutesInlineStyles): MinutesInlineContent {
  if (item.type === 'text') return { ...item, styles: { ...item.styles, [style]: true } }
  if (item.type === 'link') return { ...item, content: item.content.map((c) => ({ ...c, styles: { ...c.styles, [style]: true } })) }
  return item
}

/**
 * 1 論理行（複数の生テキスト行を `\n` で連結したもの）を inline トークン列にする。
 * `_` の強調・CommonMark の flanking 規則は扱わない。日本語に隣接した `**…**` も太字として読む。
 */
function tokenizeInline(raw: string): MinutesInlineContent[] {
  const out: MinutesInlineContent[] = []
  let buf = ''
  let i = 0
  const flush = () => {
    if (buf) {
      out.push({ type: 'text', text: buf, styles: {} })
      buf = ''
    }
  }

  while (i < raw.length) {
    const ch = raw[i]

    if (ch === '\\' && i + 1 < raw.length && ESCAPABLE_INLINE_CHARS.has(raw[i + 1])) {
      buf += raw[i + 1]
      i += 2
      continue
    }

    if (ch === '`') {
      const close = findUnescapedChar(raw, i + 1, '`')
      if (close !== -1) {
        flush()
        out.push({ type: 'text', text: raw.slice(i + 1, close), styles: { code: true } })
        i = close + 1
        continue
      }
    }

    if (raw.startsWith('~~', i)) {
      const close = findUnescapedSeq(raw, i + 2, '~~')
      if (close !== -1 && close > i + 2) {
        flush()
        out.push(...tokenizeInline(raw.slice(i + 2, close)).map((t) => addStyle(t, 'strike')))
        i = close + 2
        continue
      }
    }

    if (raw.startsWith('**', i)) {
      const close = findUnescapedSeq(raw, i + 2, '**')
      if (close !== -1 && close > i + 2) {
        flush()
        out.push(...tokenizeInline(raw.slice(i + 2, close)).map((t) => addStyle(t, 'bold')))
        i = close + 2
        continue
      }
    }

    if (ch === '*') {
      const close = findUnescapedSingleStar(raw, i + 1)
      if (close !== -1 && close > i + 1) {
        flush()
        out.push(...tokenizeInline(raw.slice(i + 1, close)).map((t) => addStyle(t, 'italic')))
        i = close + 1
        continue
      }
    }

    if (ch === '[') {
      const m = /^\[([^\]]*)\]\(([^)]*)\)/.exec(raw.slice(i))
      // href・リンクテキストに改行を含むものはリンクとして扱わない。この関数は
      // 1論理行(複数の生テキスト行を\nで連結したもの)を処理しており、リンクの
      // 構成要素に生の改行が混じると、行分割の前提が崩れて安定した往復ができない。
      if (m && !m[1].includes('\n') && !m[2].includes('\n')) {
        flush()
        const linkTextTokens = tokenizeInline(m[1]).filter((t): t is MinutesTextInline => t.type === 'text')
        out.push({
          type: 'link',
          href: m[2],
          content: linkTextTokens.length ? linkTextTokens : [{ type: 'text', text: m[2], styles: {} }],
        })
        i += m[0].length
        continue
      }
    }

    if (raw.startsWith('http://', i) || raw.startsWith('https://', i)) {
      const m = BARE_URL_RE.exec(raw.slice(i))
      if (m) {
        flush()
        out.push({ type: 'link', href: m[0], content: [{ type: 'text', text: m[0], styles: {} }] })
        i += m[0].length
        continue
      }
    }

    buf += ch
    i += 1
  }

  flush()
  return out
}

/** 行末の ` <!--task:<id>-->`（前の空白は捨てる）を taskMarker inline として取り出す。 */
function tokenizeInlineWithMarker(rawText: string): MinutesInlineContent[] {
  const m = TASK_MARKER_REGEX.exec(rawText)
  if (!m) return tokenizeInline(rawText)
  const body = rawText.slice(0, m.index).replace(/[ \t]+$/, '')
  const tokens = tokenizeInline(body)
  tokens.push({ type: TASK_MARKER_TYPE, props: { taskId: m[1] } })
  return tokens
}

// ---- ブロックパーサー（行カーソルによる再帰下降） ----

interface BlockParseResult {
  blocks: MinutesBlock[]
  nextIndex: number
}

function splitTableRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|')) {
    // 直前が `\|`（エスケープされたパイプ）なら末尾のパイプは区切りではない
    const backslashRun = /(\\*)\|$/.exec(s)
    const escaped = !!backslashRun && backslashRun[1].length % 2 === 1
    if (!escaped) s = s.slice(0, -1)
  }
  const cells: string[] = []
  let buf = ''
  let k = 0
  while (k < s.length) {
    if (s[k] === '\\' && s[k + 1] === '|') {
      buf += '|'
      k += 2
      continue
    }
    if (s[k] === '|') {
      cells.push(buf.trim())
      buf = ''
      k++
      continue
    }
    buf += s[k]
    k++
  }
  cells.push(buf.trim())
  return cells
}

function buildTableBlock(rowLines: string[]): MinutesBlock {
  const rows: MinutesTableRow[] = rowLines.map((line) => ({
    cells: splitTableRow(line).map((cellText) => tokenizeInline(cellText)),
  }))
  return {
    type: 'table',
    content: { type: 'tableContent', columnWidths: [], headerRows: 1, rows },
  }
}

function isBlockTriggerLine(line: string, lines: string[], idx: number, depth: number, end: number): boolean {
  if (FENCE_RE.test(line)) return true
  if (HEADING_RE.test(line)) return true
  if (CHECK_RE.test(line) || BULLET_RE.test(line) || NUMBERED_RE.test(line)) return true
  if (
    /^\|/.test(line) &&
    idx + 1 < end &&
    lineIndentLevel(lines[idx + 1]) === depth &&
    TABLE_SEP_RE.test(stripIndent(lines[idx + 1], depth))
  ) {
    return true
  }
  return false
}

/** 段落（連続する非空行）を1ブロックとして取り込み、次の未処理行の index を返す。 */
function consumeParagraphRun(lines: string[], start: number, end: number, depth: number, blocksOut: MinutesBlock[]): number {
  const textLines: string[] = []
  let j = start
  while (j < end) {
    const raw = lines[j]
    if (raw.trim() === '') break
    if (lineIndentLevel(raw) !== depth) break
    const line = stripIndent(raw, depth)
    if (line.startsWith('\\') && matchesBlockTrigger(line.slice(1))) {
      textLines.push(line.slice(1))
      j++
      continue
    }
    if (isBlockTriggerLine(line, lines, j, depth, end)) break
    textLines.push(line)
    j++
  }
  if (textLines.length === 0) {
    // 安全弁（呼び出し側の前提が崩れた場合の無限ループ防止）
    textLines.push(stripIndent(lines[start], depth))
    j = start + 1
  }
  blocksOut.push({ type: 'paragraph', content: tokenizeInlineWithMarker(textLines.join('\n')) })
  return j
}

function consumeListItem(lines: string[], start: number, end: number, depth: number): { block: MinutesBlock; nextIndex: number } {
  const line = stripIndent(lines[start], depth)
  let type: string
  let ownFirstLineText: string
  const props: Record<string, unknown> = {}

  const checkMatch = CHECK_RE.exec(line)
  const numberedMatch = !checkMatch ? NUMBERED_RE.exec(line) : null
  const bulletMatch = !checkMatch && !numberedMatch ? BULLET_RE.exec(line) : null

  if (checkMatch) {
    type = 'checkListItem'
    props.checked = checkMatch[1].toLowerCase() === 'x'
    ownFirstLineText = checkMatch[2]
  } else if (numberedMatch) {
    type = 'numberedListItem'
    const num = parseInt(numberedMatch[1], 10)
    if (num !== 1) props.start = num
    ownFirstLineText = numberedMatch[2]
  } else {
    type = 'bulletListItem'
    ownFirstLineText = (bulletMatch as RegExpExecArray)[1]
  }

  const ownTextLines = [ownFirstLineText]
  const children: MinutesBlock[] = []
  let j = start + 1

  while (j < end) {
    let k = j
    while (k < end && lines[k].trim() === '') k++
    if (k >= end) {
      j = k
      break
    }
    const nextRaw = lines[k]
    const nextIndent = lineIndentLevel(nextRaw)

    if (nextIndent <= depth) {
      j = k
      break
    }

    // nextIndent > depth: 子リスト or このアイテムの続き行
    const childLevel = depth + 1
    const childStripped = stripIndent(nextRaw, childLevel)
    if (nextIndent === childLevel && (CHECK_RE.test(childStripped) || BULLET_RE.test(childStripped) || NUMBERED_RE.test(childStripped))) {
      const { blocks: childBlocks, nextIndex } = parseBlocks(lines, k, end, childLevel)
      children.push(...childBlocks)
      j = nextIndex
      continue
    }

    // 字下げされた非リスト行 → 内容を落とさないため、このアイテム自身のテキストの続きとして扱う
    let contLine = stripIndent(nextRaw, childLevel)
    if (contLine.startsWith('\\') && matchesBlockTrigger(contLine.slice(1))) contLine = contLine.slice(1)
    ownTextLines.push(contLine)
    j = k + 1
  }

  const block: MinutesBlock = { type, content: tokenizeInlineWithMarker(ownTextLines.join('\n')) }
  if (Object.keys(props).length) block.props = props
  if (children.length) block.children = children
  return { block, nextIndex: j }
}

function parseBlocks(lines: string[], start: number, end: number, depth: number): BlockParseResult {
  const blocks: MinutesBlock[] = []
  let i = start

  while (i < end) {
    const raw = lines[i]
    if (raw.trim() === '') {
      i++
      continue
    }

    const indent = lineIndentLevel(raw)
    if (indent < depth) break

    if (indent > depth) {
      // このレベルに対応する親が無い字下げ行 → 生テキストとして保持する(内容を落とさない)
      const textLines: string[] = []
      while (i < end && lines[i].trim() !== '' && lineIndentLevel(lines[i]) > depth) {
        textLines.push(lines[i])
        i++
      }
      if (textLines.length === 0) {
        textLines.push(raw)
        i++
      }
      blocks.push({ type: 'paragraph', content: tokenizeInlineWithMarker(textLines.join('\n')) })
      continue
    }

    const line = stripIndent(raw, depth)

    const fenceMatch = FENCE_RE.exec(line)
    if (fenceMatch) {
      const lang = fenceMatch[1] || ''
      i++
      const codeLines: string[] = []
      let closed = false
      while (i < end) {
        const l = lines[i]
        if (lineIndentLevel(l) === depth && /^```\s*$/.test(stripIndent(l, depth))) {
          i++
          closed = true
          break
        }
        codeLines.push(lineIndentLevel(l) >= depth ? stripIndent(l, depth) : l)
        i++
      }
      void closed // 閉じないフェンスでも、末尾まで読み切って内容を落とさない
      blocks.push({ type: 'codeBlock', props: { language: lang }, content: [{ type: 'text', text: codeLines.join('\n'), styles: {} }] })
      continue
    }

    if (line.startsWith('\\') && matchesBlockTrigger(line.slice(1))) {
      i = consumeParagraphRun(lines, i, end, depth, blocks)
      continue
    }

    const headingMatch = HEADING_RE.exec(line)
    if (headingMatch) {
      blocks.push({ type: 'heading', props: { level: headingMatch[1].length }, content: tokenizeInlineWithMarker(headingMatch[2]) })
      i++
      continue
    }

    if (/^\|/.test(line) && i + 1 < end && lineIndentLevel(lines[i + 1]) === depth && TABLE_SEP_RE.test(stripIndent(lines[i + 1], depth))) {
      const rowLines: string[] = [line]
      let j = i + 2
      while (j < end && lineIndentLevel(lines[j]) === depth && /^\|/.test(stripIndent(lines[j], depth))) {
        rowLines.push(stripIndent(lines[j], depth))
        j++
      }
      blocks.push(buildTableBlock(rowLines))
      i = j
      continue
    }

    if (CHECK_RE.test(line) || BULLET_RE.test(line) || NUMBERED_RE.test(line)) {
      const { block, nextIndex } = consumeListItem(lines, i, end, depth)
      // start は「連番の先頭アイテム」だけが持つ。直前も numberedListItem なら
      // 単なる連番の続きなので、出力側の連番計算に委ねて start を落とす。
      if (block.type === 'numberedListItem' && blocks.length > 0 && blocks[blocks.length - 1].type === 'numberedListItem' && block.props) {
        delete block.props.start
        if (Object.keys(block.props).length === 0) delete block.props
      }
      blocks.push(block)
      i = nextIndex
      continue
    }

    i = consumeParagraphRun(lines, i, end, depth, blocks)
  }

  return { blocks, nextIndex: i }
}

export function parseMinutesMarkdown(md: string): MinutesBlock[] {
  const normalized = md.replace(/\r\n/g, '\n')
  if (normalized.trim() === '') return [{ type: 'paragraph', content: [] }]
  const lines = normalized.split('\n')
  const { blocks } = parseBlocks(lines, 0, lines.length, 0)
  return blocks.length ? blocks : [{ type: 'paragraph', content: [] }]
}

// ---- シリアライズ（BlockNote の editor.document をそのまま受け取れるよう防御的に読む） ----

function extractPlainText(node: unknown): string {
  if (node == null) return ''
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(extractPlainText).join('')
  if (typeof node === 'object') {
    const o = node as Record<string, unknown>
    if (typeof o.text === 'string') return o.text
    if ('content' in o) return extractPlainText(o.content)
    if ('rows' in o && Array.isArray(o.rows)) return (o.rows as unknown[]).map(extractPlainText).join(' ')
    if ('cells' in o && Array.isArray(o.cells)) return (o.cells as unknown[]).map(extractPlainText).join(' ')
    if ('children' in o) return extractPlainText(o.children)
  }
  return ''
}

type MergeableStyle = 'strike' | 'bold' | 'italic'

/** 外側→内側の適用順。隣り合うトークンのスタイル差分だけを開閉し、無駄な区切り記号の連続を避ける。 */
const STYLE_DELIM: Record<MergeableStyle, string> = { strike: '~~', bold: '**', italic: '*' }
const STYLE_ORDER: MergeableStyle[] = ['strike', 'bold', 'italic']

function inlineItemToText(item: unknown): string {
  if (item == null) return ''
  if (typeof item === 'string') return escapeText(item)
  if (typeof item !== 'object') return ''
  const o = item as Record<string, unknown>

  if (o.type === 'text') {
    const text = typeof o.text === 'string' ? o.text : ''
    const styles = o.styles && typeof o.styles === 'object' ? (o.styles as Record<string, unknown>) : {}
    if (styles.code) {
      return text.includes('`') ? escapeText(text) : '`' + text + '`'
    }
    let s = escapeText(text)
    if (styles.strike) s = `~~${s}~~`
    if (styles.bold) s = `**${s}**`
    if (styles.italic) s = `*${s}*`
    return s
  }

  if (o.type === 'link') {
    const href = typeof o.href === 'string' ? o.href : ''
    const contentArr = Array.isArray(o.content) ? o.content : []
    // 素のURLとして書けるのは、再解析時に自動リンクとして拾える http(s) URL の形をした
    // href のときだけ。それ以外(任意の文字列)を裸で埋め込むと、`~~`等の記号や行頭に
    // 化ける文字がそのまま段落に混じり、再解析のたびに構造が変わって不安定になる。
    const urlMatch = BARE_URL_RE.exec(href)
    const looksLikeUrl = !!urlMatch && urlMatch[0] === href
    if (looksLikeUrl && extractPlainText(contentArr) === href) return href
    return `[${renderTextRunList(contentArr)}](${href})`
  }

  // 未知の inline 種別 → 例外を出さず、見つかった文字をそのまま残す
  return escapeText(extractPlainText(item))
}

/**
 * text トークン列を「隣り合うトークンとのスタイル差分だけ開閉する」方式でレンダリングする。
 * トークンごとに独立して `**`/`*` を wrap すると、隣接トークンの閉じ記号と開き記号が
 * そのまま連結して `***`/`****` のような曖昧な連続記号を生み、再解析で構造が壊れる
 * （例: bold→bold+italic→bold の並びを素朴に wrap すると `**a****b*****c**` になる）。
 */
/** U+200B(幅ゼロ文字)。`*`系の区切り記号どうしが連結して `***`/`****` のような
 * 曖昧な連続記号になるのを防ぐためだけに挟む。見た目には影響しない。 */
const ZERO_WIDTH_GUARD = '\u200B'

function renderTextRunList(items: readonly unknown[]): string {
  let out = ''
  const openStack: MergeableStyle[] = []

  // `*` の区切り記号どうしが素朴に連結すると、再解析時に単独の `*`(斜体)と
  // `**`(太字)の境界があいまいになる(例: bold→bold+italic→bold を素朴に閉じ開き
  // すると `**a****b*****c**` のようになり構造が壊れる)。直前が `*` で終わり、
  // これから書く区切りも `*` から始まる場合だけ、幅ゼロ文字を1つ挟んで区切る。
  const append = (delim: string) => {
    if (delim.startsWith('*') && out.endsWith('*')) out += ZERO_WIDTH_GUARD
    out += delim
  }
  const closeTo = (common: number) => {
    while (openStack.length > common) {
      append(STYLE_DELIM[openStack.pop() as MergeableStyle])
    }
  }

  for (const raw of items) {
    const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
    if (o && o.type === 'text') {
      const styles = o.styles && typeof o.styles === 'object' ? (o.styles as Record<string, unknown>) : {}
      const text = typeof o.text === 'string' ? o.text : ''
      if (styles.code) {
        closeTo(0)
        out += text.includes('`') ? escapeText(text) : '`' + text + '`'
        continue
      }
      const wanted = STYLE_ORDER.filter((s) => styles[s])
      let common = 0
      while (common < openStack.length && common < wanted.length && openStack[common] === wanted[common]) common++
      closeTo(common)
      for (let k = common; k < wanted.length; k++) {
        append(STYLE_DELIM[wanted[k]])
        openStack.push(wanted[k])
      }
      out += escapeText(text)
      continue
    }
    // link・未知の inline 種別はスタイルを持ち越さない(閉じてから単独で書く)
    closeTo(0)
    out += inlineItemToText(raw)
  }

  closeTo(0)
  return out
}

function contentArrayToText(contentRaw: unknown): string {
  const arr = Array.isArray(contentRaw) ? contentRaw : []
  let markerId: string | null = null
  const filtered: unknown[] = []
  for (const it of arr) {
    if (it && typeof it === 'object' && (it as Record<string, unknown>).type === TASK_MARKER_TYPE) {
      const props = (it as Record<string, unknown>).props
      const id = props && typeof props === 'object' ? (props as Record<string, unknown>).taskId : undefined
      if (typeof id === 'string') markerId = id
      continue
    }
    filtered.push(it)
  }
  const text = renderTextRunList(filtered)
  return markerId !== null ? `${text} <!--task:${markerId}-->` : text
}

function getCellContent(cell: unknown): unknown {
  if (Array.isArray(cell)) return cell
  if (cell && typeof cell === 'object' && 'content' in (cell as object)) return (cell as { content: unknown }).content
  return []
}

function tableToLines(contentRaw: unknown): string[] {
  const content = contentRaw && typeof contentRaw === 'object' ? (contentRaw as Record<string, unknown>) : {}
  const rows = Array.isArray(content.rows) ? content.rows : []
  const rowTexts: string[][] = rows.map((row) => {
    const r = row && typeof row === 'object' ? (row as Record<string, unknown>) : {}
    const cells = Array.isArray(r.cells) ? r.cells : []
    return cells.map((cell) => contentArrayToText(getCellContent(cell)).replace(/\|/g, '\\|'))
  })
  if (rowTexts.length === 0) return []
  const colCount = rowTexts[0].length
  const lines: string[] = []
  lines.push('| ' + rowTexts[0].join(' | ') + ' |')
  lines.push('| ' + Array.from({ length: colCount }, () => '---').join(' | ') + ' |')
  for (let r = 1; r < rowTexts.length; r++) {
    lines.push('| ' + rowTexts[r].join(' | ') + ' |')
  }
  return lines
}

function escapeLineStart(line: string): string {
  return matchesBlockTrigger(line) ? '\\' + line : line
}

function textToLines(text: string): string[] {
  return text.split('\n').map(escapeLineStart)
}

function itemLines(marker: string, text: string): string[] {
  const parts = text.split('\n')
  const first = marker + parts[0]
  const rest = parts.slice(1).map((l) => '  ' + escapeLineStart(l))
  return [first, ...rest]
}

interface NormalizedBlockView {
  type: string
  props: Record<string, unknown>
  content: unknown
  children: unknown[]
}

function normalizeBlock(raw: unknown): NormalizedBlockView {
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>
    return {
      type: typeof o.type === 'string' ? o.type : '',
      props: o.props && typeof o.props === 'object' ? (o.props as Record<string, unknown>) : {},
      content: o.content,
      children: Array.isArray(o.children) ? o.children : [],
    }
  }
  return { type: '', props: {}, content: undefined, children: [] }
}

function blockToLines(block: NormalizedBlockView, computedNumber: number | null): string[] {
  switch (block.type) {
    case 'heading': {
      const level = Math.min(Math.max(Number(block.props.level) || 1, 1), 3)
      return ['#'.repeat(level) + ' ' + contentArrayToText(block.content)]
    }
    case 'paragraph':
      return textToLines(contentArrayToText(block.content))
    case 'bulletListItem':
      return itemLines('- ', contentArrayToText(block.content))
    case 'checkListItem': {
      const checked = !!block.props.checked
      return itemLines(checked ? '- [x] ' : '- [ ] ', contentArrayToText(block.content))
    }
    case 'numberedListItem': {
      const n = computedNumber ?? 1
      return itemLines(`${n}. `, contentArrayToText(block.content))
    }
    case 'table':
      return tableToLines(block.content)
    case 'codeBlock': {
      const lang = typeof block.props.language === 'string' ? block.props.language : ''
      const text = extractPlainText(block.content)
      return ['```' + lang, ...text.split('\n'), '```']
    }
    default: {
      const text = extractPlainText(block.content) || extractPlainText(block.children)
      return textToLines(text)
    }
  }
}

function isListItemBlockType(type: string): boolean {
  return type === 'bulletListItem' || type === 'checkListItem' || type === 'numberedListItem'
}

function serializeBlockList(blocks: unknown[], indentLevel: number): string[] {
  const prefix = '  '.repeat(indentLevel)
  const out: string[] = []
  let prevWasListItem = false
  let numCounter = 0
  let numPrevWasNumbered = false
  let isFirst = true

  for (const raw of blocks) {
    const block = normalizeBlock(raw)
    const isListItem = isListItemBlockType(block.type)

    if (!isFirst && !(prevWasListItem && isListItem)) out.push('')
    isFirst = false

    let computedNumber: number | null = null
    if (block.type === 'numberedListItem') {
      const explicitStart = typeof block.props.start === 'number' ? block.props.start : null
      computedNumber = explicitStart !== null ? explicitStart : numPrevWasNumbered ? numCounter + 1 : 1
      numCounter = computedNumber
      numPrevWasNumbered = true
    } else {
      numPrevWasNumbered = false
      numCounter = 0
    }

    out.push(...blockToLines(block, computedNumber).map((l) => prefix + l))

    if (block.children.length) {
      out.push(...serializeBlockList(block.children, indentLevel + 1))
    }

    prevWasListItem = isListItem
  }

  return out
}

/**
 * BlockNote の `editor.document`（id・既定 props 付きの完全な Block 配列）をそのまま渡せる。
 * 知らない props（textColor・backgroundColor・textAlignment・id など）は無視し、知らない
 * ブロック/inline 種別でも例外を出さず、見つかった文字を段落として書き出す。
 */
export function serializeMinutesBlocks(blocks: ReadonlyArray<unknown>): string {
  const arr = Array.isArray(blocks) ? blocks : []
  if (arr.length === 0) return ''
  return serializeBlockList(arr, 0).join('\n')
}
