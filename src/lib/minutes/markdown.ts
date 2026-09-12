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
 * 土台は `supabase/migrations/20240206_000_minutes_parser.sql`。現在この関数が
 * 実際に生きているのは `supabase/migrations/20260911143112_space_role_boundary.sql`
 * の `rpc_parse_meeting_minutes` / `rpc_get_minutes_preview`(`v_line ~
 * '^-\s*\[\s*\]\s*SPEC\([^)]+\):\s*.+$'`)。この定数はそのパターンと一致させること
 * (`src/__tests__/lib/minutes/markdown.test.ts` でマイグレーションから抜き出して確認)。
 */
export const SPEC_LINE_REGEX = /^-\s*\[\s*\]\s*SPEC\([^)]+\):\s*.+$/

/**
 * 同 RPC 内の `v_line ~ '<!--task:[^>]+-->\s*$'` と同一パターン。
 */
export const TASK_MARKER_REGEX = /<!--task:([^>]+)-->\s*$/

// ---- 行レベルの文法パターン ----

// 3つ以上のバッククォート(長いフェンス)を開きとして受ける。info string は
// バッククォートさえ含まなければ空白入り(`js title="x"`)も許す。
const FENCE_RE = /^(`{3,})([^`]*)$/
const HEADING_RE = /^(#{1,3})[ \t]+(.*)$/
const CHECK_RE = /^[-*+][ \t]+\[([ xX])\][ \t]*(.*)$/
const BULLET_RE = /^[-*+][ \t]+(.*)$/
const NUMBERED_RE = /^(\d+)\.[ \t]+(.*)$/
const TABLE_SEP_RE = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/

/**
 * 素のURL(裸で書ける http(s) URL)として許す文字。ASCII の URL らしい文字だけに
 * 絞る(全角/日本語や `()*~\`[]\` はここで打ち切る)。全角記号や日本語に続けて
 * 書かれた URL(`詳細はhttps://a.bを参照`)がそこまで飲み込んで壊れるのを防ぎ、
 * この文法で特別な意味を持つ記号との結合による再解析時の不安定化も避ける
 * (`[text](href)` の明示リンクとしてなら任意の文字を書ける)。
 */
const BARE_URL_RE = /^https?:\/\/[A-Za-z0-9\-._:/?#@!$&'+,;=%]+/
/** 素のURLの末尾に付きがちな文の区切り記号は URL に含めない(例: 「…を参照。」の直前)。 */
const BARE_URL_TRAILING_PUNCT_RE = /[.,:;!?]+$/

/** `英字:` の形の scheme(RFC 3986 と同じ字種)。判定は正規化した文字列に対して行う。 */
const HREF_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/
/** リンクにしてよい scheme。これ以外の scheme が付いていたらリンクにしない。 */
const SAFE_HREF_SCHEMES = new Set(['http:', 'https:', 'mailto:'])
/**
 * HTML の文字参照(`&#58;` `&#x3A;` `&colon;` `&Tab;` など)。href にこれが入って
 * いたらリンクにしない。属性値として DOM に直接入れる限りは文字のままだが、
 * 同じ minutes_md をメールや相手先ポータルで HTML に組み立てて出す経路があると
 * `javascript&#58;alert(1)` が `javascript:` に戻ってしまう。議事録のリンクに
 * 文字参照を書く必要はまず無いので、まとめて拒否して文字として残す。
 */
const HREF_CHAR_REFERENCE_RE = /&#?[a-z0-9]+;/
/** 先頭2文字がスラッシュ/バックスラッシュの組み合わせか(ブラウザは `//` と同じに解釈する)。 */
const SLASHY = new Set(['/', '\\'])

/**
 * `[text](href)` の href として受け付ける形だけを通す。
 *
 * AI/CLI が書いた議事録を BlockNote で開くため、`javascript:` `data:` 等を
 * リンクにしてしまうとクリック時にスクリプトが動く恐れがある。一方で
 * `docs/a.md` `./x` `?q=1` のような相対リンクは議事録で普通に書かれるので、
 * 「許可リストに無ければ拒否」だと本文が文字に化けてしまう。そこで
 * **scheme が付いていたら http/https/mailto だけ許し、scheme が無ければ
 * 相対リンクとして許す**という形にする。大文字小文字・前後の空白・
 * タブ/改行等の制御文字で偽装した scheme(`JaVaScRiPt:`・`\tjavascript:`)も
 * 弾けるよう、判定だけ制御文字/空白を除いた正規化した文字列で行う。
 */
function isSafeLinkHref(href: string): boolean {
  const normalized = href.replace(/[\x00-\x1f\x7f\s]+/g, '').toLowerCase()
  // 飛び先の無いリンクは作らない(読み込み/書き出しの両方で文字として残す)
  if (normalized === '') return false
  // HTML の文字参照で scheme を偽装したものは拒否(上の定数の説明を参照)
  if (HREF_CHAR_REFERENCE_RE.test(normalized)) return false
  const scheme = HREF_SCHEME_RE.exec(normalized)
  if (scheme) return SAFE_HREF_SCHEMES.has(scheme[0])
  // scheme 無し = 相対リンク。ただし先頭が `//` `/\` `\/` `\\` のものは
  // ブラウザが「プロトコル相対」として外部サイトへ飛ばすので拒否する。
  if (SLASHY.has(normalized[0]) && SLASHY.has(normalized[1])) return false
  return true
}

/**
 * href を `(` から読み、対応する `)` が来るまでを href とする(括弧の対応を数える)。
 * `[^)]*` のような単純な形だと、Wikipedia のように href 自体に `(...)` を含む
 * リンク(例: `/wiki/東京_(曖昧さ回避)`)が最初の `)` で切れてしまう。生の改行は
 * 許さない(この関数は複数の生テキスト行を`\n`で連結した1論理行を処理しており、
 * href に生の改行が混じると行分割の前提が崩れて安定した往復ができない)。
 */
function scanBalancedHref(raw: string, from: number): { href: string; end: number } | null {
  let depth = 0
  for (let i = from; i < raw.length; i++) {
    const c = raw[i]
    if (c === '\n') return null
    if (c === '(') {
      depth++
    } else if (c === ')') {
      if (depth === 0) return { href: raw.slice(from, i), end: i }
      depth--
    }
  }
  return null
}

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

/**
 * 行頭の `\` が「行の逃がし」(段落強制)かどうか。次の文字が `*` `` ` `` `~` `\`
 * (文字としての逃がし)のときは行の逃がしとして外さない。例えば `\* 注: ` は
 * 「見た目が箇条書きに見える段落」ではなく「文字としての `*` に続く普通の文」で、
 * 続く inline トークナイザ側の `\` エスケープに任せるべきもの。ここで先に
 * 外してしまうと、後続の `*重要*` が正しく斜体として読めなくなる(実際に踏んだ不具合)。
 */
function isEscapedTriggerLine(line: string): boolean {
  if (!line.startsWith('\\')) return false
  const next = line[1]
  if (next !== undefined && ESCAPABLE_INLINE_CHARS.has(next)) return false
  return matchesBlockTrigger(line.slice(1))
}

/** 行頭の半角スペースの個数(生の文字数)。2スペース単位を仮定しない。 */
function lineIndentChars(line: string): number {
  const m = /^( *)/.exec(line)
  return m ? m[1].length : 0
}

function stripIndent(line: string, chars: number): string {
  return line.slice(chars)
}

// ---- inline 文字エスケープ ----

const ESCAPABLE_INLINE_CHARS = new Set(['\\', '*', '`', '~'])
/**
 * リンクの表示文字(`[...]` の中)では `]` も逃がせる。でないと `[参考] 資料`
 * のように表示文字に `]` を含むリンク(議事録でよくある書き方)が、最初の `]` で
 * 切れてリンクにならず、href が本文に丸ごと出てしまう。
 */
const LINK_TEXT_ESCAPABLE_CHARS = new Set([...ESCAPABLE_INLINE_CHARS, ']'])

/**
 * 1行分の inline を組み立てる器。
 *
 * 「文字(ユーザーが書いた本文)」と「区切り記号(`**` `*` `~~` やリンクの記号)」を
 * 1文字ずつ分けて溜め、**すべて並べ終えてから**逃がし(`\`)を決める。逃がすか
 * どうかは「隣にどの文字が来るか」で決まるので、トークン(スタイルの切れ目)ごとに
 * 判断すると答えがずれる — 読み込むとスタイルが同じ隣のトークンは1つにまとまり、
 * リンクも許可外 href なら文字に変わるため、同じ本文なのに「トークンの端かどうか」
 * が変わってしまい、書き直すたびに `\~` と `~` が入れ替わる不具合があった。
 */
interface InlineBuf {
  /** 1文字ずつ(絵文字などのサロゲートペアは1要素)。 */
  chars: string[]
  /** 同じ位置の文字が「ユーザーの本文」か(true なら逃がしの対象)。 */
  literal: boolean[]
}

function newInlineBuf(): InlineBuf {
  return { chars: [], literal: [] }
}

function pushChars(buf: InlineBuf, text: string, literal: boolean): void {
  for (const ch of text) {
    buf.chars.push(ch)
    buf.literal.push(literal)
  }
}

/**
 * 溜めた文字を1本の文字列にする。逃がしの規則:
 * - 文字としての `*` `` ` `` はどこにあっても逃がす(単独でも区切りと誤読されうる)
 * - `~` は隣にもう1つ `~` が来て `~~`(取り消し線)になるときだけ逃がす。単独の
 *   `~`(例: `10:00~11:00`)はそのまま書く(読みやすさのため)
 * - `\` は**次の文字**が `\` `*` `` ` `` `~` のとき(読み込み側がエスケープとして
 *   食べてしまう並び)だけ逃がす。行末や `C:\Users\taro` はそのまま書く
 */
function finishInlineBuf(buf: InlineBuf, inLinkText = false): string {
  const escapable = inLinkText ? LINK_TEXT_ESCAPABLE_CHARS : ESCAPABLE_INLINE_CHARS
  let out = ''
  for (let i = 0; i < buf.chars.length; i++) {
    const ch = buf.chars[i]
    if (!buf.literal[i]) {
      out += ch
      continue
    }
    if (ch === '*' || ch === '`') {
      out += '\\' + ch
      continue
    }
    // リンクの表示文字の中では、文字としての `]` を逃がして閉じと区別する
    if (ch === ']' && inLinkText) {
      out += '\\]'
      continue
    }
    if (ch === '~' && (buf.chars[i - 1] === '~' || buf.chars[i + 1] === '~')) {
      out += '\\~'
      continue
    }
    // 次の文字が `*`/`` ` ``/`~`/`\` なら、それが文字として逃がされて `\` で
    // 始まっても、区切り記号としてそのまま出ても、どちらでも読み込み側の
    // エスケープに食べられる並びになる。そこだけ逃がせばよい。
    if (ch === '\\' && i + 1 < buf.chars.length && escapable.has(buf.chars[i + 1])) {
      out += '\\\\'
      continue
    }
    out += ch
  }
  return out
}

/**
 * U+200B(幅ゼロ文字)。`*` 系の区切り記号どうしが連結して `***`/`****` のような
 * 曖昧な連続記号になるのを防ぐ最後の保険としてだけ挟む。見た目には影響しない。
 * 太字+斜体をまとめて開閉する場合は `***` を使うため(下記参照)、通常はここまで
 * 頼らずに済む。ソースに見えない文字を直接書かないよう \u200B のエスケープで書く。
 */
const ZERO_WIDTH_GUARD = '\u200B'

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

/**
 * リンクの表示文字(`[...]`)の閉じ `]` を探す。文字としての `]` は書き出し側が
 * `\]` にするので飛ばす。コード表記(`` `...` ``)の中は逃がしが効かない
 * (CommonMark と同じくコード内にエスケープは無い)ので、その区間ごと飛ばす。
 * そうしないと `[`a]b`](href)` のようにコードの中の `]` で切れてしまう。
 */
function findLinkTextEnd(raw: string, from: number): number {
  let k = from
  while (k < raw.length) {
    const ch = raw[k]
    if (ch === '\\') {
      k += 2
      continue
    }
    if (ch === '`') {
      // 空のコード表記(``)は文字として扱う(読み込み側と同じ判定)ので飛ばさない
      const close = raw.indexOf('`', k + 1)
      if (close !== -1 && close > k + 1) {
        k = close + 1
        continue
      }
    }
    if (ch === ']') return k
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
function tokenizeInline(rawInput: string, noLinks = false): MinutesInlineContent[] {
  // `*` と `*` に挟まれた幅ゼロ文字(U+200B)は本文の内容ではない。区切りとして
  // だけ使い、下のメインループでバッファへ足さずに読み飛ばす(モデルに残さない)。
  // こうすることで、選択範囲へのスタイル付け外しを繰り返しても増え続けない。
  const raw = rawInput
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

    // noLinks = 「リンクの表示文字の中を読んでいる」。そこだけ `\]` も外す。
    if (ch === '\\' && i + 1 < raw.length && (noLinks ? LINK_TEXT_ESCAPABLE_CHARS : ESCAPABLE_INLINE_CHARS).has(raw[i + 1])) {
      buf += raw[i + 1]
      i += 2
      continue
    }

    if (ch === '`') {
      // コード表記の中では `\` はただの文字(CommonMark と同じくコード内はエスケープ
      // なし)。findUnescapedChar だと `\`` を「エスケープされた閉じ」と誤読して
      // 本来の閉じ `` ` `` を素通りしてしまうため、単純な indexOf で次の ` を探す。
      const close = raw.indexOf('`', i + 1)
      const codeText = close !== -1 ? raw.slice(i + 1, close) : ''
      // 空のコード表記(` `` `)はコードにせず、2つのバッククォートを文字として
      // 残す(要素を作らずに読み飛ばすと、その2文字が本文から消えてしまう)。
      if (close !== -1 && codeText) {
        flush()
        out.push({ type: 'text', text: codeText, styles: { code: true } })
        i = close + 1
        continue
      }
    }

    if (raw.startsWith('~~', i)) {
      const close = findUnescapedSeq(raw, i + 2, '~~')
      if (close !== -1 && close > i + 2) {
        flush()
        out.push(...tokenizeInline(raw.slice(i + 2, close), noLinks).map((t) => addStyle(t, 'strike')))
        i = close + 2
        continue
      }
    }

    // 4個以上連続する `*` はどの区切りとも対応が決めがたく、組み合わせ次第で
    // 再帰的な突合せが極端に深くなる(約7,700個の連続で実際に RangeError を確認)。
    // 文字としてまとめて扱い、区切り記号としては解釈しない。
    if (raw[i + 3] === '*' && raw.startsWith('****', i)) {
      let end = i
      while (raw[end] === '*') end++
      buf += raw.slice(i, end)
      i = end
      continue
    }

    // `***text***`(太字+斜体をまとめて開閉する AI流の書き方)を先に試す。ここを
    // 飛ばすと "**" 判定が先に食いつき、太字("*text")+平文("*")に誤って割れる。
    if (raw.startsWith('***', i)) {
      const close = findUnescapedSeq(raw, i + 3, '***')
      if (close !== -1 && close > i + 3) {
        flush()
        out.push(...tokenizeInline(raw.slice(i + 3, close), noLinks).map((t) => addStyle(addStyle(t, 'bold'), 'italic')))
        i = close + 3
        continue
      }
    }

    if (raw.startsWith('**', i)) {
      const close = findUnescapedSeq(raw, i + 2, '**')
      if (close !== -1 && close > i + 2) {
        flush()
        out.push(...tokenizeInline(raw.slice(i + 2, close), noLinks).map((t) => addStyle(t, 'bold')))
        i = close + 2
        continue
      }
    }

    if (ch === '*') {
      const close = findUnescapedSingleStar(raw, i + 1)
      if (close !== -1 && close > i + 1) {
        flush()
        out.push(...tokenizeInline(raw.slice(i + 1, close), noLinks).map((t) => addStyle(t, 'italic')))
        i = close + 1
        continue
      }
    }

    // 画像 `![alt](src)` はリンクにしない(文字として残す)。href の規則を
    // 相対パスまで許したため、`!` を除いた部分が普通のリンクとして成立して
    // しまい、画像がリンクに化ける。文字のまま残せば読み書きで形も変わらない。
    if (ch === '[' && !noLinks && raw[i - 1] !== '!') {
      // 閉じの `]` は「逃がされておらず、コード表記の中でもない最初の `]`」。
      // 表示文字に含まれる `]` は書き出し側が `\]` にする(コードの中は飛ばす)ので、
      // ここで同じ規則で飛ばせばリンクとして読める。
      const closeBracket = findLinkTextEnd(raw, i + 1)
      const linkText = closeBracket !== -1 ? raw.slice(i + 1, closeBracket) : null
      const hrefScan = linkText !== null && raw[closeBracket + 1] === '(' ? scanBalancedHref(raw, closeBracket + 2) : null
      // href・リンクテキストに改行を含むものはリンクとして扱わない。この関数は
      // 1論理行(複数の生テキスト行を\nで連結したもの)を処理しており、リンクの
      // 構成要素に生の改行が混じると、行分割の前提が崩れて安定した往復ができない。
      // href が許可した形(http/https/mailto/相対パス)でないものは
      // リンクにせず、`[text](href)` をそのまま文字として残す(内容は落とさない)。
      if (linkText !== null && !linkText.includes('\n') && hrefScan && isSafeLinkHref(hrefScan.href)) {
        // リンク文字の中では素のURL自動認識を切る(でないと `[https://a](https://b)` の
        // ような入力で文字側が内側リンクに化け、外側リンクの表示文字が失われる)。
        const linkTextTokens = tokenizeInline(linkText, true).filter((t): t is MinutesTextInline => t.type === 'text')
        // 表示文字が無い `[](href)` はリンクにしない。href を表示文字に流用すると
        // 書き出し→読み込みのたびに本文の文字が増えてしまう。文字として残す。
        if (linkTextTokens.length) {
          flush()
          out.push({ type: 'link', href: hrefScan.href, content: linkTextTokens })
          i = hrefScan.end + 1
          continue
        }
      }
    }

    if (!noLinks && (raw.startsWith('http://', i) || raw.startsWith('https://', i))) {
      const m = BARE_URL_RE.exec(raw.slice(i))
      const trimmed = m ? m[0].replace(BARE_URL_TRAILING_PUNCT_RE, '') : ''
      if (trimmed) {
        flush()
        out.push({ type: 'link', href: trimmed, content: [{ type: 'text', text: trimmed, styles: {} }] })
        i += trimmed.length
        continue
      }
    }

    // `*` と `*` に挟まれた幅ゼロ文字は区切りとしてだけ使い、文字として拾わない
    // (HIGH-2)。両隣が実際に `*` かどうかは生の文字列だけを見て判定するので、
    // 何本連続していても・エスケープと混ざっていても安全に読み飛ばせる。
    // この関数は `*` で囲まれた中身を再帰的に読むため、強調の中身の端に来た
    // 幅ゼロ文字は「反対側の `*`」が切り出した文字列の外にある。その場合は
    // 文字列の端であること自体を `*` の代わりとみなす(でないと本文に残り、
    // スタイルを付け外しするたびに増えていく)。
    if (ch === ZERO_WIDTH_GUARD) {
      const prevIsStar = raw[i - 1] === '*'
      const nextIsStar = raw[i + 1] === '*'
      const leftOk = prevIsStar || (i === 0 && nextIsStar)
      const rightOk = nextIsStar || (i === raw.length - 1 && prevIsStar)
      if (leftOk && rightOk) {
        i += 1
        continue
      }
    }

    buf += ch
    i += 1
  }

  flush()
  return out
}

/**
 * 複数の生テキスト行(`\n`結合前)を inline トークン列にする。目印 ` <!--task:<id>-->` は
 * **最初の行の行末**からだけ拾う。DB 側(SQL)は minutes_md を1行ずつ見て
 * `^-\s*\[\s*\]\s*SPEC\(...)` に一致する行だけを未処理とみなすため、目印も
 * その1行目に対応していないと意味がない。作成済みの SPEC 項目へ Shift+Enter で
 * 補足を足すと、目印が2行目以降に押し出され、DB からは「未作成の行」に見えて
 * 同じタスクを二重に作ってしまう(BlockNote 実機で再現)。
 */
function tokenizeLinesWithMarker(lines: readonly string[]): MinutesInlineContent[] {
  if (lines.length === 0) return tokenizeInline('')
  const [first, ...rest] = lines
  const m = TASK_MARKER_REGEX.exec(first)
  if (!m) return tokenizeInline(lines.join('\n'))
  // 書き出し側は目印の前に必ず半角スペース1個だけを足す(下の contentArrayToText
  // 参照)。ここで複数の空白/タブをまとめて剥がすと、文字そのものの末尾の空白まで
  // 一緒に消えて、書き戻すたびに空白の数が変わってしまう。1個だけ外す。
  const newFirst = first.slice(0, m.index).replace(/ $/, '')
  const tokens = tokenizeInline([newFirst, ...rest].join('\n'))
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

/** 書き出し側が表のセル改行に使う `<br>`(大小文字・`<br/>`も許容)。 */
const BR_TAG_RE = /<br\s*\/?>/gi
/** 文字として書かれた `<br>` を逃がした形(`<\br>`・`<\\br>` …)。 */
const ESCAPED_BR_TAG_RE = /<\\(\\*)(br\s*\/?)>/gi

/**
 * 表のセルは1行に収める必要があるため改行を `<br>` で書く。すると本文に文字と
 * して書かれた `<br>` が読み込みで改行に化けてしまうので、書き出す時に `<` と
 * `br` の間へ `\` を1つ足して逃がす。すでに逃がされている `<\br>` にはさらに
 * 1つ足すので、何度書き直しても情報が混ざらない(読み込み側で1つ外す)。
 */
function escapeLiteralBrTags(text: string): string {
  return text.replace(/<(\\*)(br\s*\/?)>/gi, (_m, slashes: string, tag: string) => `<\\${slashes}${tag}>`)
}

function unescapeLiteralBrTags(text: string): string {
  return text.replace(ESCAPED_BR_TAG_RE, (_m, slashes: string, tag: string) => `<${slashes}${tag}>`)
}

function buildTableBlock(rowLines: string[]): MinutesBlock {
  const rows: MinutesTableRow[] = rowLines.map((line) => ({
    // 先に本物の `<br>` を改行へ戻し(逃がした `<\br>` には一致しない)、
    // そのあとで逃がしを1つ外す。この順でないと文字の `<br>` も改行に化ける。
    cells: splitTableRow(line).map((cellText) => tokenizeInline(unescapeLiteralBrTags(cellText.replace(BR_TAG_RE, '\n')))),
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
    lineIndentChars(lines[idx + 1]) === depth &&
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
    if (lineIndentChars(raw) !== depth) break
    const line = stripIndent(raw, depth)
    if (isEscapedTriggerLine(line)) {
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
  blocksOut.push({ type: 'paragraph', content: tokenizeLinesWithMarker(textLines) })
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
    // 通常の箇条書きの文字が `[ ] `/`[x] ` で始まると、素の Markdown ではチェック
    // 項目と区別が付かない。書き出し側は `\[` で逃がすので、ここで一段だけ外す。
    if (/^\\\[[ xX]\]/.test(ownFirstLineText)) ownFirstLineText = ownFirstLineText.slice(1)
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
    const nextIndent = lineIndentChars(nextRaw)

    if (nextIndent <= depth) {
      j = k
      break
    }

    // nextIndent > depth: 子リスト or このアイテムの続き行。子の基準幅は「今より
    // 深く字下げされていれば良い」とし、実際にその行が使っている幅をそのまま
    // 採用する(AI がよく書く3〜4スペースの字下げもそのまま子として受ける)。
    const childLevel = nextIndent
    const childStripped = stripIndent(nextRaw, childLevel)
    if (CHECK_RE.test(childStripped) || BULLET_RE.test(childStripped) || NUMBERED_RE.test(childStripped)) {
      const { blocks: childBlocks, nextIndex } = parseBlocks(lines, k, end, childLevel)
      children.push(...childBlocks)
      j = nextIndex
      continue
    }

    // 字下げされた非リスト行 → 内容を落とさないため、このアイテム自身のテキストの続きとして扱う
    let contLine = stripIndent(nextRaw, childLevel)
    if (isEscapedTriggerLine(contLine)) contLine = contLine.slice(1)
    ownTextLines.push(contLine)
    j = k + 1
  }

  const block: MinutesBlock = { type, content: tokenizeLinesWithMarker(ownTextLines) }
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

    const indent = lineIndentChars(raw)
    if (indent < depth) break

    if (indent > depth) {
      // このレベルに対応する親が無い字下げ行 → 生テキストとして保持する(内容を落とさない)
      const textLines: string[] = []
      while (i < end && lines[i].trim() !== '' && lineIndentChars(lines[i]) > depth) {
        textLines.push(lines[i])
        i++
      }
      if (textLines.length === 0) {
        textLines.push(raw)
        i++
      }
      blocks.push({ type: 'paragraph', content: tokenizeLinesWithMarker(textLines) })
      continue
    }

    const line = stripIndent(raw, depth)

    const fenceMatch = FENCE_RE.exec(line)
    if (fenceMatch) {
      const fenceLen = fenceMatch[1].length
      const lang = fenceMatch[2].trim()
      // 閉じは「開きと同じ数以上のバッククォートだけの行」。開きが4個以上なら
      // 中に3個の```が出てきても閉じにならない(書き出し側もこれに合わせる)。
      const closeRe = new RegExp('^`{' + fenceLen + ',}\\s*$')
      i++
      const codeLines: string[] = []
      let closed = false
      while (i < end) {
        const l = lines[i]
        if (lineIndentChars(l) === depth && closeRe.test(stripIndent(l, depth))) {
          i++
          closed = true
          break
        }
        codeLines.push(lineIndentChars(l) >= depth ? stripIndent(l, depth) : l)
        i++
      }
      void closed // 閉じないフェンスでも、末尾まで読み切って内容を落とさない
      blocks.push({ type: 'codeBlock', props: { language: lang }, content: [{ type: 'text', text: codeLines.join('\n'), styles: {} }] })
      continue
    }

    if (isEscapedTriggerLine(line)) {
      i = consumeParagraphRun(lines, i, end, depth, blocks)
      continue
    }

    const headingMatch = HEADING_RE.exec(line)
    if (headingMatch) {
      blocks.push({ type: 'heading', props: { level: headingMatch[1].length }, content: tokenizeLinesWithMarker([headingMatch[2]]) })
      i++
      continue
    }

    if (/^\|/.test(line) && i + 1 < end && lineIndentChars(lines[i + 1]) === depth && TABLE_SEP_RE.test(stripIndent(lines[i + 1], depth))) {
      const rowLines: string[] = [line]
      let j = i + 2
      while (j < end && lineIndentChars(lines[j]) === depth && /^\|/.test(stripIndent(lines[j], depth))) {
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

/** inline トークン列のどれかに強調/コードが付いているか。 */
function hasAnyStyle(items: readonly unknown[]): boolean {
  return items.some((it) => {
    const o = it && typeof it === 'object' ? (it as Record<string, unknown>) : null
    const styles = o && o.styles && typeof o.styles === 'object' ? (o.styles as Record<string, unknown>) : null
    return !!styles && Object.values(styles).some(Boolean)
  })
}

type MergeableStyle = 'strike' | 'bold' | 'italic'

/** 外側→内側の適用順。隣り合うトークンのスタイル差分だけを開閉し、無駄な区切り記号の連続を避ける。 */
const STYLE_DELIM: Record<MergeableStyle, string> = { strike: '~~', bold: '**', italic: '*' }
const STYLE_ORDER: MergeableStyle[] = ['strike', 'bold', 'italic']

/**
 * link・未知の inline 種別を器へ積む。リンクの記号(`[` `](href)`)は区切り記号
 * として、表示文字は文字として積むので、逃がしの判断が隣の文字と噛み合う。
 */
function pushInlineItem(buf: InlineBuf, item: unknown): void {
  if (item == null) return
  if (typeof item === 'string') {
    pushChars(buf, item, true)
    return
  }
  if (typeof item !== 'object') return
  const o = item as Record<string, unknown>

  if (o.type === 'link') {
    const href = typeof o.href === 'string' ? o.href : ''
    const contentArr = Array.isArray(o.content) ? o.content : []
    const plain = extractPlainText(contentArr)
    // 読み込み側が弾く href(許可外 scheme・飛び先なし)と、表示文字が無いリンクは
    // `[text](href)` の形で書かず、その文字列を**文字として**積む。読み書きの規則を
    // そろえないと、書いた形が読み込みで文字に化けてそのたびに形が変わる。
    if (!isSafeLinkHref(href) || plain === '') {
      pushChars(buf, `[${plain}](${href})`, true)
      return
    }
    // 素のURLとして書けるのは、再解析時に自動リンクとして拾える http(s) URL の形をした
    // href のときだけ。それ以外(任意の文字列)を裸で埋め込むと、`~~`等の記号や行頭に
    // 化ける文字がそのまま段落に混じり、再解析のたびに構造が変わって不安定になる。
    // 強調が付いている場合も裸では書けない(裸のURLに強調は載せられず、書くと消える)。
    const urlMatch = BARE_URL_RE.exec(href)
    const looksLikeUrl = !!urlMatch && urlMatch[0] === href
    if (looksLikeUrl && plain === href && !hasAnyStyle(contentArr)) {
      pushChars(buf, href, false)
      return
    }
    // リンクは表示文字の中だけ `]` の逃がし規則が変わるので、別の器で組み立てて
    // 出来上がった文字列を「区切り記号」として親の器へ積む(読み込み側も
    // `[...]` の中だけ `\]` を外すので、規則が一致する)。
    const linkBuf = newInlineBuf()
    pushChars(linkBuf, '[', false)
    renderInlineInto(linkBuf, contentArr)
    pushChars(linkBuf, `](${href})`, false)
    pushChars(buf, finishInlineBuf(linkBuf, true), false)
    return
  }

  // 未知の inline 種別 → 例外を出さず、見つかった文字をそのまま残す
  pushChars(buf, extractPlainText(item), true)
}

/**
 * text トークン列を「隣り合うトークンとのスタイル差分だけ開閉する」方式でレンダリングする。
 * トークンごとに独立して `**`/`*` を wrap すると、隣接トークンの閉じ記号と開き記号が
 * そのまま連結して `***`/`****` のような曖昧な連続記号を生み、再解析で構造が壊れる
 * （例: bold→bold+italic→bold の並びを素朴に wrap すると `**a****b*****c**` になる）。
 */
interface StyleStackEntry {
  styles: MergeableStyle[]
  delim: string
}

/**
 * 強調(`**` `*` `~~`)の内側の端にある半角空白/タブを、強調の外側の素の文字へ
 * 出す(MEDIUM-1)。`* 重要*` のように空白を内側に抱えると、その強調が行頭に来た
 * ときに箇条書き(`* `)と見分けが付かず、行の逃がし `\` と inline の逃がし `\*`
 * がぶつかって読み書きのたびに形が変わる。埋め込み改行も「行の端」になるので、
 * 改行ごとに区切って端の空白を外へ出す。コード表記(`` ` ``)は中の空白がその
 * まま見た目に出るので対象にしない。
 */
function liftEdgeWhitespace(items: readonly unknown[]): unknown[] {
  const out: unknown[] = []
  const pushPlain = (text: string) => {
    if (text) out.push({ type: 'text', text, styles: {} })
  }
  for (const raw of items) {
    const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
    const styles = o && o.styles && typeof o.styles === 'object' ? (o.styles as Record<string, unknown>) : null
    const text = o && typeof o.text === 'string' ? o.text : null
    if (!o || o.type !== 'text' || text === null || !styles || styles.code || !STYLE_ORDER.some((s) => styles[s])) {
      out.push(raw)
      continue
    }
    const segments = text.split('\n')
    segments.forEach((segment, idx) => {
      if (idx > 0) pushPlain('\n')
      const m = /^([ \t]*)([\s\S]*?)([ \t]*)$/.exec(segment) as RegExpExecArray
      pushPlain(m[1])
      // 中身が空白だけなら強調は消えるが、空白の文字としては残るので内容は落ちない
      if (m[2]) out.push({ ...o, text: m[2] })
      pushPlain(m[3])
    })
  }
  return out
}

function renderInlineInto(buf: InlineBuf, itemsRaw: readonly unknown[]): void {
  const items = liftEdgeWhitespace(itemsRaw)
  const openStack: StyleStackEntry[] = []

  // `*` の区切り記号どうしが素朴に連結すると、再解析時に単独の `*`(斜体)と
  // `**`(太字)の境界があいまいになる。最後の保険として、直前が `*` で終わり
  // これから書く区切りも `*` から始まる場合だけ、幅ゼロ文字を1つ挟む
  // (通常は下の「太字+斜体をまとめて `***` にする」処理でここに来ない)。ただし
  // 直前の `*` が**文字としての** `*`(書き出しで `\*` に逃がされる)なら、
  // 閉じ/開きと結合してもあいまいにならないので幅ゼロ文字を入れない。
  const append = (delim: string) => {
    const last = buf.chars.length - 1
    if (delim.startsWith('*') && buf.chars[last] === '*' && !buf.literal[last]) pushChars(buf, ZERO_WIDTH_GUARD, false)
    pushChars(buf, delim, false)
  }
  const closeTo = (entryCount: number) => {
    while (openStack.length > entryCount) {
      append((openStack.pop() as StyleStackEntry).delim)
    }
  }

  for (const raw of items) {
    const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
    if (o && o.type === 'text') {
      const styles = o.styles && typeof o.styles === 'object' ? (o.styles as Record<string, unknown>) : {}
      const text = typeof o.text === 'string' ? o.text : ''
      if (styles.code) {
        closeTo(0)
        // 中身にバッククォートがあるとコード表記で囲めないので、文字として積む
        if (text.includes('`')) pushChars(buf, text, true)
        else {
          pushChars(buf, '`', false)
          pushChars(buf, text, false)
          pushChars(buf, '`', false)
        }
        continue
      }
      const wanted = STYLE_ORDER.filter((s) => styles[s])

      // openStack をスタイル単位に展開して wanted との共通の頭を求める
      const flatOpen: MergeableStyle[] = []
      openStack.forEach((entry) => flatOpen.push(...entry.styles))
      let common = 0
      while (common < flatOpen.length && common < wanted.length && flatOpen[common] === wanted[common]) common++

      // common がエントリの境目でない(bold+italic の片方だけ落とす等)場合は、
      // そのエントリごと閉じる。丸め込みで足りなくなった分は下の open で開き直す。
      let cum = 0
      let entryCommon = 0
      for (const entry of openStack) {
        if (cum + entry.styles.length > common) break
        cum += entry.styles.length
        entryCommon++
      }
      closeTo(entryCommon)

      for (let k = cum; k < wanted.length; ) {
        // bold の直後に italic を同時に開く場合は `***` としてまとめて開く。
        // 個別に `**`+`*` を書くと再解析時に閉じ側と結合して曖昧になるため。
        if (wanted[k] === 'bold' && wanted[k + 1] === 'italic') {
          append('***')
          openStack.push({ styles: ['bold', 'italic'], delim: '***' })
          k += 2
          continue
        }
        append(STYLE_DELIM[wanted[k]])
        openStack.push({ styles: [wanted[k]], delim: STYLE_DELIM[wanted[k]] })
        k += 1
      }
      pushChars(buf, text, true)
      continue
    }
    // link・未知の inline 種別はスタイルを持ち越さない(閉じてから単独で書く)
    closeTo(0)
    pushInlineItem(buf, raw)
  }

  closeTo(0)
}

function renderTextRunList(items: readonly unknown[]): string {
  const buf = newInlineBuf()
  renderInlineInto(buf, items)
  return finishInlineBuf(buf)
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
  if (markerId === null) return text
  // 目印は元の並び順に関わらず「最初の行の行末」に正規化する(HIGH-1参照)。
  const lines = text.split('\n')
  lines[0] = `${lines[0]} <!--task:${markerId}-->`
  return lines.join('\n')
}

function getCellContent(cell: unknown): unknown {
  if (Array.isArray(cell)) return cell
  if (cell && typeof cell === 'object' && 'content' in (cell as object)) return (cell as { content: unknown }).content
  return []
}

/**
 * タスク化の目印は SPEC 行(checkListItem)の1行目のためのもので、表のセルには
 * 意味を持たない(DB 側は表のセルを行として見ない)。`<br>` による改行の書き換えと
 * 目印の行頭正規化が重なって不安定になるのも避けたいので、セルの中では捨てる。
 */
function dropTaskMarkers(contentRaw: unknown): unknown {
  const arr = Array.isArray(contentRaw) ? contentRaw : []
  return arr.filter((it) => !(it && typeof it === 'object' && (it as Record<string, unknown>).type === TASK_MARKER_TYPE))
}

function tableToLines(contentRaw: unknown): string[] {
  const content = contentRaw && typeof contentRaw === 'object' ? (contentRaw as Record<string, unknown>) : {}
  const rows = Array.isArray(content.rows) ? content.rows : []
  const rowTexts: string[][] = rows.map((row) => {
    const r = row && typeof row === 'object' ? (row as Record<string, unknown>) : {}
    const cells = Array.isArray(r.cells) ? r.cells : []
    // 表のセルは1つの `| ... |` 行に収まる必要があるため、セル内の改行は `<br>` で書く
    // (読み込み側で `\n` に戻す)。生の改行のままだと行が割れて表そのものが壊れる。
    // セルの前後の空白は読み込み側で必ず trim される(splitTableRow)ため、
    // 書き出す時点で先に落としておかないと2回目の変換で消えて不安定になる。
    return cells.map((cell) =>
      // 文字として書かれた `<br>` を先に逃がしてから、本物の改行を `<br>` にする
      // (順番が逆だと、逃がしが本物の改行にも掛かって改行が文字に化ける)。
      escapeLiteralBrTags(contentArrayToText(dropTaskMarkers(getCellContent(cell))))
        .replace(/\n/g, '<br>')
        .replace(/\|/g, '\\|')
        .trim(),
    )
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

/**
 * 別のブロックに化ける形の行に、行の逃がし `\` を足す。
 *
 * すでに文字としての `\` で始まり、その後ろがブロックの形をしている行
 * (`\- x` `\   ` 等)にも足す。そのまま書くと読み込み側が先頭の `\` を
 * 「行の逃がし」として外してしまい、本文の `\` が消える(読み直すたびに
 * 形が変わる)。`\` を足して `\\- x` と書けば、読み込み側は inline の
 * エスケープとして `\` を1つ外し、元の文字に戻る。
 */
function escapeLineStart(line: string): string {
  return matchesBlockTrigger(line) || isEscapedTriggerLine(line) ? '\\' + line : line
}

/**
 * マーカー/見出しの `#`/リストの `- ` などの直後にある先頭の空白は、再解析の
 * 貪欲な区切り(`[ \t]+`)に飲み込まれ区別が付かないため先に落とす(見出し・
 * リスト項目の共通処理)。逃がしは `finishInlineBuf` が「隣の文字」だけを見て
 * 決めており、前後の空白を落としても答えは変わらないので追加の手当ては要らない。
 */
function trimLeadingSeparatorWhitespace(text: string): string {
  return text.replace(/^[ \t]+/, '')
}

/**
 * 段落/リスト項目の複数行テキストの中に埋め込まれた空行(空白のみの行)を落とす。
 * パーサーは空行に出会うと段落/項目をそこで終えてしまう(空行をまたいで
 * 1つのブロックとして続けることはない)ため、埋め込み空行をそのまま書き出すと
 * 再解析のたびに構造が変わって不安定になる。書き出す時点で先に畳んでおく。
 * テキスト全体が空(単独の空段落)のときはそのまま('')残す。
 */
function collapseEmbeddedBlankLines(text: string): string {
  // 改行を含まない(単独の空段落を含む)ときはそのまま返す。改行入りで全行が
  // 空白のときは、複数の空行と1個の空文字列は再解析後に見分けが付かないので
  // 空文字列に正規化する(空行を2本以上残すと、その本数が再解析のたびに変わる)。
  if (!text.includes('\n')) return text
  const lines = text.split('\n').filter((l) => l.trim() !== '')
  return lines.join('\n')
}

function textToLines(text: string): string[] {
  // 空白だけの段落(スペースやタブを打っただけの行)は空段落と同じに正規化する。
  // そのまま書くとブロック間の空行と見分けが付かず、読み込みで消えてしまい
  // 書き直すたびに行数が変わる(下の isEmptyParagraph と同じ判断)。
  const collapsed = collapseEmbeddedBlankLines(text)
  if (collapsed.trim() === '') return ['']
  return collapsed.split('\n').map(escapeLineStart)
}

function itemLines(marker: string, text: string): string[] {
  const parts = collapseEmbeddedBlankLines(text).split('\n')
  // マーカーと文字の間の区切り(`[ \t]+`/`[ \t]*`)は再解析時に貪欲にすべての
  // 空白を飲み込むため、文字側の先頭にある余分な空白は区別が付かず消える。
  // 書き出す時点で先に落としておく(見出しの先頭空白と同じ理由)。
  const firstPart = trimLeadingSeparatorWhitespace(parts[0])
  // 普通の箇条書き(`- `)の文字が `[ ] `/`[x] ` で始まると素の Markdown では
  // チェック項目と区別できない。`\[` で逃がし、普通の箇条書きのまま読み戻せるようにする。
  const firstText = marker === '- ' && /^\[[ xX]\]/.test(firstPart) ? '\\' + firstPart : firstPart
  const first = marker + firstText
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
      // 見出しは1行だけの形。中身に生の改行が混じっていたら空白に置き換える
      // (`<br>` は表セル用の約束ごとなので見出しでは使わない)。先頭の空白は
      // `#` との区切りと再解析時に見分けが付かず飲み込まれるので、先に落とす。
      const text = trimLeadingSeparatorWhitespace(contentArrayToText(block.content).replace(/\n/g, ' '))
      return ['#'.repeat(level) + ' ' + text]
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
      // 中身に ``` 相当の行があると、そのまま3つのバッククォートで囲むと途中で
      // 閉じてしまう。中身の最長のバッククォート連続より長いフェンスで囲む。
      const longestBacktickRun = (text.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0)
      const fence = '`'.repeat(Math.max(3, longestBacktickRun + 1))
      return [fence + lang, ...text.split('\n'), fence]
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

/** `SPEC(` で始まる checkListItem か(タスク化 RPC が拾う SPEC 項目)。 */
function isSpecCheckItem(block: NormalizedBlockView): boolean {
  if (block.type !== 'checkListItem') return false
  return /^SPEC\(/.test(contentArrayToText(block.content))
}

interface FlatEntry {
  block: NormalizedBlockView
  indent: number
}

/**
 * ブロック木を「実際に書き出す行の並び」へ平らにする(方式b)。
 *
 * - SPEC 項目(`SPEC(` で始まる checkListItem)は、木のどこにあっても常に最上位
 *   (字下げなし)に出す。DB 側(SQL)は minutes_md の各行を単独で見て
 *   `^-\s*\[\s*\]\s*SPEC\(...)` に一致するかだけを判定するため、字下げされた
 *   SPEC 行は「未処理の行」として認識されず、タスクが作られない(実際に踏んだ不具合)。
 * - 字下げ(2スペース)で読み戻せるのは「リスト項目の子がリスト項目」のときだけ
 *   (パーサーが子リストとして認識する形はそれだけ)。それ以外の組み合わせ
 *   (段落/見出しの子、SPEC項目の子、非リスト種別の子)は字下げせず、親と同じ段
 *   として直後に並べる。関係は失われるが、読み戻しても壊れない形を優先する。
 */
function flattenBlocks(blocks: readonly unknown[], indent: number, out: FlatEntry[]): void {
  for (const raw of blocks) {
    pushBlockAndChildren(normalizeBlock(raw), indent, out)
  }
}

/**
 * 1ブロックと、その子を「実際に書き出す段」で out に積む。
 *
 * 子の並びの中で一度でも「理想の1段深い位置」に置けない子(SPEC・非リスト種別・
 * 既に浅い段へ落ちた後続)が出たら、それ以降の兄弟(とその子)も同じ浅い段へ
 * 道連れにする(HIGH-3)。そうしないと、浅い段に出した子より後ろの兄弟だけが
 * 元の深い段のまま残り、読み戻すと直前の(浅い段の)兄弟の子に誤って吸い込まれる
 * (`\  - 補足B` に化ける・2回目の保存で形が変わる、という不具合があった)。
 * 「浅い段」は固定の親の段ではなく、直前の兄弟が実際に置かれた段を引き継ぐ
 * (入れ子の項目の下の見出し/コードは、その項目と同じ段に出す)。
 */
function pushBlockAndChildren(block: NormalizedBlockView, indent: number, out: FlatEntry[]): void {
  const isSpec = isSpecCheckItem(block)
  const effectiveIndent = isSpec ? 0 : indent
  out.push({ block, indent: effectiveIndent })

  if (block.children.length === 0) return

  const parentIsIndentableList = isListItemBlockType(block.type) && !isSpec
  let broken = !parentIsIndentableList
  let lastIndent = effectiveIndent

  for (const childRaw of block.children) {
    const childBlock = normalizeBlock(childRaw)
    const childIsSpec = isSpecCheckItem(childBlock)
    const childIndent = childIsSpec ? 0 : !broken && isListItemBlockType(childBlock.type) ? effectiveIndent + 1 : lastIndent
    if (childIndent !== effectiveIndent + 1) broken = true
    lastIndent = childIndent
    pushBlockAndChildren(childBlock, childIndent, out)
  }
}

/**
 * 空(または空白だけ)の paragraph か。空白だけの段落も「空行」としか書けず、
 * 読み込みで消えてしまうので同じ扱いにする(SPEC 判定用の contentArrayToText
 * 呼び出しと共有できるよう独立させる)。
 */
function isEmptyParagraph(block: NormalizedBlockView): boolean {
  return block.type === 'paragraph' && contentArrayToText(block.content).trim() === ''
}

function serializeBlockList(blocks: unknown[]): string[] {
  const flat: FlatEntry[] = []
  flattenBlocks(blocks, 0, flat)

  // 空段落は、他に何も無ければ「空の議事録」の唯一のしるしとして残し(''を返す)、
  // それ以外(間に挟まる・末尾に付く等)は落とす。ブロック間の空行と見分けが付かず、
  // そのまま書くと再解析のたびに空行の数が変わって不安定になるため。
  const normalized = flat.length > 1 ? flat.filter(({ block }) => !isEmptyParagraph(block)) : flat

  const out: string[] = []
  let prevWasListItem = false
  let isFirst = true
  // 連番は「段(字下げ)ごと」に数える。深い段の行(子)が間に挟まっても、
  // その段の map エントリには触れないので同じ段の連番は途切れない(HIGH-4)。
  const lastTypeByIndent = new Map<number, string>()
  const counterByIndent = new Map<number, number>()

  for (const { block, indent } of normalized) {
    const isListItem = isListItemBlockType(block.type)

    if (!isFirst && !(prevWasListItem && isListItem)) out.push('')
    isFirst = false

    let computedNumber: number | null = null
    if (block.type === 'numberedListItem') {
      // BlockNote は「直前(同じ段)も numberedListItem」なら途中の start を無視して
      // 連番のまま数える(実機で確認)。start が効くのは連番の先頭アイテムだけ。
      const explicitStart = typeof block.props.start === 'number' ? block.props.start : null
      const continuesRun = lastTypeByIndent.get(indent) === 'numberedListItem'
      computedNumber = continuesRun ? (counterByIndent.get(indent) ?? 0) + 1 : (explicitStart ?? 1)
      counterByIndent.set(indent, computedNumber)
    }
    lastTypeByIndent.set(indent, block.type)

    const prefix = '  '.repeat(indent)
    out.push(...blockToLines(block, computedNumber).map((l) => prefix + l))

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
  return serializeBlockList(arr).join('\n')
}
