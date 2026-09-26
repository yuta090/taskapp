'use client'

import { Fragment, useContext, useMemo, useState, type ReactNode } from 'react'
import { CheckSquare, Square } from '@phosphor-icons/react'
import {
  MEETING_NOTE_TYPE,
  parseMinutesMarkdown,
  serializeMinutesBlocks,
  TASK_MARKER_TYPE,
  TOGGLE_TYPE,
  type MinutesBlock,
  type MinutesInlineContent,
  type MinutesLinkInline,
  type MinutesTableCell,
  type MinutesTableContent,
  type MinutesTextInline,
} from '@/lib/minutes/markdown'
import { stripInternalLinks } from '@/lib/minutes/internalLinks'
import { formatNoteStampLabel, normalizeNoteAuthor } from '@/lib/minutes/noteStamp'
// エディタを読み込まない中身だけを使う（docPollBlock.tsx は BlockNote ごと持ち込むので使わない）
import { DocPollBlock } from '@/components/editor/docPoll/DocPollContext'
import { DOC_POLL_TYPE } from '@/lib/doc-polls/logic'
import type { DocPollReasonRequired } from '@/lib/doc-polls/types'
import { DocInsertionView } from '@/components/editor/docInsertion/DocInsertionView'
import { DOC_INSERTION_TYPE, type DocInsertion, type DocInsertionKind } from '@/lib/doc-insertions/logic'
import { PortalInsertionContext, type PortalInsertionContextValue } from './PortalInsertionContext'
import { InsertionComposer, PendingInsertion, WithdrawButton } from './PortalInsertionParts'

/**
 * このアプリのホスト名。社内の人がアドレスバーからコピーした絶対URL
 * (`https://agentpm.app/<org>/project/…`)も社内向けとして押せない文字にするために使う。
 * `NEXT_PUBLIC_` の値はビルド時に埋め込まれるので、サーバーとブラウザで同じ値になる
 * (描き直しで表示が食い違わない)。
 */
const APP_HOST = ((): string | undefined => {
  const raw = process.env.NEXT_PUBLIC_APP_URL
  if (!raw) return undefined
  try {
    return new URL(raw).host
  } catch {
    return undefined
  }
})()

/**
 * 相手先ポータルの議事録を「読める文書」として組み立てる読み取り専用の部品。
 *
 * Wiki 編集で使う BlockNote は重いのでポータルには持ち込まない。議事録の正本は
 * Markdown(`meetings.minutes_md`)なので、自前パーサー(`parseMinutesMarkdown`)で
 * 一度ブロック木に起こし、社内向けの相対リンクを取り除いてから素の React 要素を
 * 組み立てる。`dangerouslySetInnerHTML` は使わない(信頼できない文字列を HTML として
 * 差し込まないため)。
 */

const LIST_ITEM_TYPES = new Set(['bulletListItem', 'numberedListItem', 'checkListItem'])

function isListItemType(type: string): boolean {
  return LIST_ITEM_TYPES.has(type)
}

// ---- inline ----

/**
 * HTML コメント(`<!--task:uuid-->` など)を文字から落とす。
 *
 * パーサーが目印として拾うのは「1行目の行末」に付いているものだけなので、
 * AI/CLI が書いた議事録では表のセルや行の途中に目印が残ることがある。社内の
 * 覚え書きを相手先の画面に出さないため、コメントの形はまとめて落とす。
 */
function stripHtmlComments(text: string): string {
  return text.includes('<!--') ? text.replace(/<!--[\s\S]*?-->/g, '') : text
}

function renderText(item: MinutesTextInline, key: React.Key): ReactNode {
  let node: ReactNode = stripHtmlComments(item.text)
  if (item.styles.code) node = <code className="rounded bg-gray-100 px-1 py-0.5 text-xs">{node}</code>
  if (item.styles.bold) node = <strong className="font-semibold">{node}</strong>
  if (item.styles.italic) node = <em>{node}</em>
  if (item.styles.strike) node = <s>{node}</s>
  return <Fragment key={key}>{node}</Fragment>
}

function renderLink(item: MinutesLinkInline, key: React.Key): ReactNode {
  return (
    <a
      key={key}
      href={item.href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-indigo-ink underline hover:no-underline"
    >
      {item.content.map((t, i) => renderText(t, i))}
    </a>
  )
}

function renderInline(items: readonly MinutesInlineContent[]): ReactNode[] {
  return items
    .map((item, i): ReactNode => {
      if (item.type === 'text') return renderText(item, i)
      if (item.type === 'link') return renderLink(item, i)
      // taskMarker(議事録タスク化の目印)は社内向けの情報なので相手先には見せない
      if (item.type === TASK_MARKER_TYPE) return null
      // これから増える inline の種別で本文が黙って消えないように、文字があれば出す
      const maybeText = (item as { text?: unknown }).text
      return typeof maybeText === 'string' ? renderText({ type: 'text', text: maybeText, styles: {} }, i) : null
    })
    .filter((node): node is ReactNode => node !== null)
}

/** 段落・見出しの中身が実質空(文字を持たない)かどうか。空行から来た空段落を描かないための判定。 */
function isEmptyInline(items: readonly MinutesInlineContent[]): boolean {
  return items.every((item) => item.type === TASK_MARKER_TYPE || (item.type === 'text' && item.text.trim() === ''))
}

// ---- block ----

/**
 * 議事録の見出しは、ページの見出し（会議名）の下にぶら下がるので1段落として出す
 * （議事録の見出し1 = ページの中では h2）。HTML の見出しは6段までなので、
 * 議事録の見出し5・6はどちらも h6 にする。
 */
type MinutesHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6
const HEADING_TAG = { 1: 'h2', 2: 'h3', 3: 'h4', 4: 'h5', 5: 'h6', 6: 'h6' } as const
const HEADING_CLASS: Record<MinutesHeadingLevel, string> = {
  1: 'text-base font-semibold text-gray-900',
  2: 'text-sm font-semibold text-gray-900',
  3: 'text-sm font-medium text-gray-900',
  // 見出し4以降は編集画面でも本文と同じ大きさの太字なので、見た目もそれに合わせる
  4: 'text-sm font-medium text-gray-900',
  5: 'text-sm font-medium text-gray-900',
  6: 'text-sm font-medium text-gray-900',
}
const HEADING_MT: Record<MinutesHeadingLevel, string> = {
  1: 'mt-5',
  2: 'mt-4',
  3: 'mt-3',
  4: 'mt-3',
  5: 'mt-3',
  6: 'mt-3',
}

function headingLevel(block: MinutesBlock): MinutesHeadingLevel {
  const level = block.props?.level
  if (typeof level !== 'number') return 1
  if (level < 1) return 1
  if (level > 6) return 6
  return Math.round(level) as MinutesHeadingLevel
}

function renderHeading(block: MinutesBlock, key: React.Key, isFirst: boolean): ReactNode {
  const level = headingLevel(block)
  const Tag = HEADING_TAG[level]
  const items = Array.isArray(block.content) ? block.content : []
  const classes = [HEADING_CLASS[level], 'mb-1.5']
  if (!isFirst) classes.push(HEADING_MT[level])
  return (
    <Tag key={key} className={classes.join(' ')}>
      {renderInline(items)}
    </Tag>
  )
}

function renderParagraph(block: MinutesBlock, key: React.Key): ReactNode {
  const items = Array.isArray(block.content) ? block.content : []
  if (isEmptyInline(items)) return null
  return (
    <p key={key} className="text-sm text-gray-700 leading-[1.8] whitespace-pre-wrap my-2">
      {renderInline(items)}
    </p>
  )
}

function renderCodeBlock(block: MinutesBlock, key: React.Key): ReactNode {
  const first = Array.isArray(block.content) ? block.content[0] : undefined
  const text = first && first.type === 'text' ? first.text : ''
  return (
    <pre key={key} className="overflow-x-auto rounded bg-gray-50 border border-gray-200 p-3 my-3 text-xs text-gray-700">
      <code>{text}</code>
    </pre>
  )
}

function cellContent(cell: MinutesInlineContent[] | MinutesTableCell): MinutesInlineContent[] {
  return Array.isArray(cell) ? cell : cell.content
}

function renderTable(block: MinutesBlock, key: React.Key): ReactNode {
  const content = block.content as MinutesTableContent
  const headerRowCount = typeof content.headerRows === 'number' ? content.headerRows : 1
  return (
    <div key={key} className="overflow-x-auto my-3">
      <table className="min-w-full text-xs border border-gray-200">
        <tbody>
          {content.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.cells.map((cell, cellIndex) => {
                const isHeader = rowIndex < headerRowCount
                const CellTag = isHeader ? 'th' : 'td'
                // セルの中の改行(元の Markdown では `<br>`)をそのまま見せる
                const className = isHeader
                  ? 'border border-gray-200 bg-gray-50 px-2 py-1 text-left font-medium text-gray-700 whitespace-pre-wrap'
                  : 'border border-gray-200 px-2 py-1 text-gray-700 align-top whitespace-pre-wrap'
                return (
                  <CellTag key={cellIndex} className={className}>
                    {renderInline(cellContent(cell))}
                  </CellTag>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function renderListItem(block: MinutesBlock, key: React.Key): ReactNode {
  const items = Array.isArray(block.content) ? block.content : []
  const childNodes = block.children && block.children.length ? renderBlocks(block.children) : null

  if (block.type === 'checkListItem') {
    const checked = block.props?.checked === true
    const Icon = checked ? CheckSquare : Square
    return (
      <li key={key} className="flex items-start gap-1.5">
        <Icon className="mt-0.5 shrink-0 text-gray-400" />
        {/* 子は入れ子のリストだけでなく段落・見出し・表も来るので、span ではなく div で受ける */}
        <div className="min-w-0 flex-1 whitespace-pre-wrap">
          {renderInline(items)}
          {childNodes}
        </div>
      </li>
    )
  }

  return (
    // 項目の中の改行(Shift+Enter で書いた続き行)をそのまま見せる
    <li key={key} className="whitespace-pre-wrap">
      {renderInline(items)}
      {childNodes}
    </li>
  )
}

function renderListGroup(type: string, group: readonly MinutesBlock[], key: React.Key): ReactNode {
  if (type === 'checkListItem') {
    return (
      <ul key={key} className="pl-0 space-y-1 my-2 text-sm text-gray-700 leading-[1.8]">
        {group.map((item, i) => renderListItem(item, i))}
      </ul>
    )
  }
  if (type === 'numberedListItem') {
    const start = typeof group[0]?.props?.start === 'number' ? group[0].props.start : undefined
    return (
      <ol key={key} start={start} className="list-decimal pl-5 space-y-1 my-2 text-sm text-gray-700 leading-[1.8]">
        {group.map((item, i) => renderListItem(item, i))}
      </ol>
    )
  }
  return (
    <ul key={key} className="list-disc pl-5 space-y-1 my-2 text-sm text-gray-700 leading-[1.8]">
      {group.map((item, i) => renderListItem(item, i))}
    </ul>
  )
}

/**
 * 折りたたみ。相手先には**開いた状態**で出す（畳んだままだと、中に書いた大事な話を
 * 読み落とす）。読む側が自分で畳めるように、ブラウザ標準の折りたたみを使う。
 */
function renderToggle(block: MinutesBlock, key: React.Key): ReactNode {
  const items = Array.isArray(block.content) ? block.content : []
  const childNodes = block.children && block.children.length ? renderBlocks(block.children) : null
  return (
    // 箇条書き（`list-disc pl-5`）と同じ段に置く。Markdown 上は隣り合う兄弟なので、
    // 折りたたみだけ左にずれていると別の階層に見える
    <details key={key} open data-testid="portal-minutes-toggle" className="my-2 pl-5">
      <summary className="cursor-pointer text-sm text-gray-700 leading-[1.8]">{renderInline(items)}</summary>
      {/* 中身が無いときは囲みごと出さない */}
      {childNodes ? <div className="pl-4">{childNodes}</div> : null}
    </details>
  )
}

/** 会議メモ。編集画面と同じ色の囲みで出す（会議中に足した補足だと分かるように）。 */
function renderMeetingNote(block: MinutesBlock, key: React.Key): ReactNode {
  const items = Array.isArray(block.content) ? block.content : []
  const createdAt = block.props?.createdAt
  const label = formatNoteStampLabel(typeof createdAt === 'string' ? createdAt : undefined)
  const author = normalizeNoteAuthor(typeof block.props?.author === 'string' ? block.props.author : undefined)
  return (
    <div
      key={key}
      data-testid="portal-minutes-meeting-note"
      className="my-2 flex items-start gap-2 rounded border-l-4 border-blue-200 bg-blue-50 py-1 pl-3 pr-2 text-sm text-gray-700 leading-[1.8]"
    >
      <div className="min-w-0 flex-1 whitespace-pre-wrap">{renderInline(items)}</div>
      {author && (
        <span
          data-testid="portal-minutes-meeting-note-author"
          title={author}
          className="max-w-[10rem] shrink-0 truncate pt-1 text-[10px] text-gray-500"
        >
          {author}
        </span>
      )}
      {label && (
        <span
          data-testid="portal-minutes-meeting-note-time"
          className="shrink-0 pt-1 text-[10px] text-gray-400"
        >
          {label}
        </span>
      )}
    </div>
  )
}

function renderBlock(block: MinutesBlock, key: React.Key, isFirst: boolean): ReactNode {
  switch (block.type) {
    case 'heading':
      return renderHeading(block, key, isFirst)
    case TOGGLE_TYPE:
      return renderToggle(block, key)
    case MEETING_NOTE_TYPE:
      return renderMeetingNote(block, key)
    case DOC_INSERTION_TYPE:
      return (
        <div key={key} className="my-2 text-sm text-gray-700 leading-[1.8]">
          <InsertionBlock block={block} />
        </div>
      )
    case DOC_POLL_TYPE:
      // 投票。押せるかどうか・票は、外側の DocPollHost が配るもので決まる（無ければ「この画面では投票できません」）
      return (
        <div key={key} className="my-2">
          <DocPollBlock
            pollId={typeof block.props?.pollId === 'string' ? block.props.pollId : ''}
            reasonRequired={(block.props?.reasonRequired === 'ng_hold' ? 'ng_hold' : 'none') as DocPollReasonRequired}
            title={<span className="text-sm text-gray-700">{renderInline(Array.isArray(block.content) ? block.content : [])}</span>}
          />
        </div>
      )
    case 'table':
      return renderTable(block, key)
    case 'codeBlock':
      return renderCodeBlock(block, key)
    case 'paragraph':
      return renderParagraph(block, key)
    default:
      // 未知のブロック種別は文字を落とさないよう段落として描く
      return renderParagraph(block, key)
  }
}

/**
 * ブロック配列を React 要素に組み立てる。連続する同じ種類のリスト項目
 * (bulletListItem/numberedListItem/checkListItem)は1つの ul/ol にまとめる
 * (項目ごとに ul を作ると見た目のリストが分断されるため)。
 *
 * `isDocumentRoot` が true のときだけ、文書の最初のブロックの上余白を外す
 * (見出しの mt-* クラス)。リスト項目の中の入れ子ブロックはここには当たらない。
 */
function renderBlocks(blocks: readonly MinutesBlock[], isDocumentRoot = false): ReactNode[] {
  const out: ReactNode[] = []
  let atStart = isDocumentRoot
  let i = 0
  while (i < blocks.length) {
    const block = blocks[i]
    if (isListItemType(block.type)) {
      const type = block.type
      const group: MinutesBlock[] = []
      while (i < blocks.length && blocks[i].type === type) {
        group.push(blocks[i])
        i++
      }
      out.push(renderListGroup(type, group, out.length))
      atStart = false
      continue
    }
    out.push(renderBlock(block, out.length, atStart))
    atStart = false
    i++
  }
  return out
}

export interface PortalMinutesDocumentProps {
  md: string
}

/**
 * 本文に入った「相手先が足した行・メモ」。自分が足したもので反映済みなら「削除」（消してもらう）を出す。
 */
function InsertionBlock({ block }: { block: MinutesBlock }) {
  const ctx = useContext(PortalInsertionContext)
  const props = (block.props ?? {}) as Record<string, unknown>
  const id = typeof props.insertionId === 'string' ? props.insertionId : ''
  const mine = ctx?.rows.find((r) => r.id === id)
  return (
    <DocInsertionView
      kind={props.kind === 'meeting_note' ? 'meeting_note' : 'paragraph'}
      author={typeof props.author === 'string' ? props.author : ''}
      createdAt={typeof props.createdAt === 'string' ? props.createdAt : ''}
      badge={
        mine?.status === 'remove_requested' ? <span className="rounded bg-gray-100 px-1 text-gray-500">削除待ち</span> : undefined
      }
      actions={
        mine?.status === 'applied' && ctx ? <WithdrawButton label="削除" onWithdraw={() => ctx.withdraw(id)} /> : undefined
      }
    >
      {renderInline(Array.isArray(block.content) ? block.content : [])}
    </DocInsertionView>
  )
}

/** 最上位の1まとまり（見出し・段落・箇条書きのまとまり など） */
interface RootUnit {
  node: ReactNode
  /** まとまりの最後の行の位置。後ろに足すときの目印（その行の Markdown）は、要るときだけ作る */
  lastIndex: number
}

/** この後ろに足すときに送る目印（その行の Markdown。社内の画面が同じ行を探す） */
function anchorOf(original: readonly MinutesBlock[], lastIndex: number): string {
  try {
    return serializeMinutesBlocks([original[lastIndex]]).trim()
  } catch {
    return ''
  }
}

function buildRootUnits(shown: readonly MinutesBlock[]): RootUnit[] {
  const units: RootUnit[] = []
  let i = 0
  while (i < shown.length) {
    const type = shown[i].type
    const start = i
    if (isListItemType(type)) {
      while (i < shown.length && shown[i].type === type) i++
    } else {
      i++
    }
    const node = isListItemType(type)
      ? renderListGroup(type, shown.slice(start, i), units.length)
      : renderBlock(shown[start], units.length, units.length === 0)
    units.push({ node, lastIndex: i - 1 })
  }
  return units
}

/**
 * 書き足せる本文（相手先ポータルの議事録・DOC_VOTE_SPEC §5）。まとまりごとに「＋」を出し、押すとその下に欄を開く。
 * 自分の差し込みで本文にまだ出ていないもの（反映待ち・反映済みだが本文が古い）は、足した場所の後ろに重ねて出す。
 * 足した場所が見つからないもの（そのあとで行が書き換えられた）は末尾に出す。
 */
function InsertableDocument({
  original,
  shown,
  ctx,
}: {
  original: readonly MinutesBlock[]
  shown: readonly MinutesBlock[]
  ctx: PortalInsertionContextValue
}) {
  const [openAt, setOpenAt] = useState<number | 'end' | null>(null)
  const units = useMemo(() => buildRootUnits(shown), [shown])
  const inBody = useMemo(() => {
    const ids = new Set<string>()
    const walk = (blocks: readonly MinutesBlock[]) => {
      for (const b of blocks) {
        const id = (b.props as Record<string, unknown> | undefined)?.insertionId
        if (b.type === DOC_INSERTION_TYPE && typeof id === 'string') ids.add(id)
        if (b.children?.length) walk(b.children)
      }
    }
    walk(original)
    return ids
  }, [original])
  // 重ねて出すのは反映待ちだけ（反映済みは本文が正。社内が本文から消した行を出し続けない）
  const overlay = ctx.rows.filter((r) => r.status === 'pending' && !inBody.has(r.id))
  // 目印（本文の Markdown）づくりは重いので、重ねて出すものがあるときだけ作る
  const hasOverlay = overlay.length > 0
  const unitAnchors = useMemo(
    () => (hasOverlay ? units.map((u) => anchorOf(original, u.lastIndex)) : null),
    [units, original, hasOverlay]
  )
  const at = (idx: number) =>
    unitAnchors ? overlay.filter((r) => r.anchor !== null && r.anchor.trim() === unitAnchors[idx]) : []
  const anchorSet = new Set(unitAnchors ?? [])
  const atEnd = overlay.filter((r) => r.anchor === null || !anchorSet.has(r.anchor.trim()))

  const submit = (lastIndex: number | null) => async (kind: DocInsertionKind, content: string) => {
    await ctx.create(kind, content, lastIndex === null ? null : anchorOf(original, lastIndex))
    setOpenAt(null)
  }
  const pendingList = (rows: DocInsertion[]) =>
    rows.map((r) => <PendingInsertion key={r.id} row={r} onWithdraw={ctx.withdraw} />)

  return (
    <div>
      {units.map((unit, idx) => (
        <div key={idx} className="group relative pr-7">
          {unit.node}
          <button
            type="button"
            aria-label="この後ろに書き足す"
            title="この後ろに書き足す"
            onClick={() => setOpenAt(idx)}
            // スマホは乗せる操作が無いので薄く出しておく。PC は乗せたときだけ
            className="absolute right-0 top-1 rounded px-1.5 text-sm text-gray-400 opacity-60 hover:bg-gray-100 hover:text-gray-600 md:opacity-0 md:group-hover:opacity-100"
          >
            ＋
          </button>
          {pendingList(at(idx))}
          {openAt === idx && <InsertionComposer onSubmit={submit(unit.lastIndex)} onCancel={() => setOpenAt(null)} />}
        </div>
      ))}
      {pendingList(atEnd)}
      {openAt === 'end' ? (
        <InsertionComposer onSubmit={submit(null)} onCancel={() => setOpenAt(null)} />
      ) : (
        <button
          type="button"
          onClick={() => setOpenAt('end')}
          className="mt-3 rounded border border-dashed border-gray-300 px-3 py-1 text-xs text-gray-500 hover:bg-gray-50"
        >
          ＋ 行・メモを足す
        </button>
      )}
    </div>
  )
}

export function PortalMinutesDocument({ md }: PortalMinutesDocumentProps): ReactNode {
  const insertion = useContext(PortalInsertionContext)
  // 本文が変わらないかぎり組み立て直さない。議事録が長いと変換は同期で重くなる
  // (実測: 約300KB・4,000ブロックで 17ms。相手先の端末はこれより遅い)ので、
  // 画面のほかの操作による描き直しのたびに走らせない。
  // 書き足せる画面では、足す場所の目印を作るために元の本文（社内リンクを外す前）も持つ
  const parsed = useMemo<{ original: MinutesBlock[]; shown: MinutesBlock[] } | null>(() => {
    if (!insertion || !md || !md.trim()) return null
    try {
      const original = parseMinutesMarkdown(md)
      return { original, shown: stripInternalLinks(original, APP_HOST) }
    } catch {
      return null
    }
  }, [insertion, md])

  const insertable = insertion != null
  const nodes = useMemo<ReactNode[] | null>(() => {
    if (insertable || !md || !md.trim()) return null
    // JSX の組み立て自体は try の外で行う(ESLint react-hooks/error-boundaries の
    // 指摘どおり、try/catch の中で JSX を作っても React のレンダリング時の例外は
    // 捕まえられない)。ここで捕まえたいのは Markdown → ブロック木への変換の失敗。
    try {
      return renderBlocks(stripInternalLinks(parseMinutesMarkdown(md), APP_HOST), true)
    } catch {
      return null
    }
  }, [md, insertable])

  if (insertion) {
    // 本文がまだ無くても、末尾に足す欄は出す（会議中に最初の1行を足せるように）
    if (parsed) return <InsertableDocument original={parsed.original} shown={parsed.shown} ctx={insertion} />
    if (!md || !md.trim()) return <InsertableDocument original={[]} shown={[]} ctx={insertion} />
  }

  if (!md || !md.trim()) return null

  if (nodes === null) {
    // 変換に失敗しても画面を落とさない。元の見た目(生テキスト)に戻すだけ
    return <div className="whitespace-pre-wrap text-sm text-gray-700">{md}</div>
  }
  return <div>{nodes}</div>
}
