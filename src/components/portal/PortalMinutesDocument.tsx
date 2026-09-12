'use client'

import { Fragment, useMemo, type ReactNode } from 'react'
import { CheckSquare, Square } from '@phosphor-icons/react'
import {
  parseMinutesMarkdown,
  TASK_MARKER_TYPE,
  type MinutesBlock,
  type MinutesInlineContent,
  type MinutesLinkInline,
  type MinutesTableCell,
  type MinutesTableContent,
  type MinutesTextInline,
} from '@/lib/minutes/markdown'
import { stripInternalLinks } from '@/lib/minutes/internalLinks'

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

const HEADING_TAG = { 1: 'h2', 2: 'h3', 3: 'h4' } as const
const HEADING_CLASS: Record<1 | 2 | 3, string> = {
  1: 'text-base font-semibold text-gray-900',
  2: 'text-sm font-semibold text-gray-900',
  3: 'text-sm font-medium text-gray-900',
}
const HEADING_MT: Record<1 | 2 | 3, string> = { 1: 'mt-5', 2: 'mt-4', 3: 'mt-3' }

function headingLevel(block: MinutesBlock): 1 | 2 | 3 {
  const level = block.props?.level
  return level === 2 || level === 3 ? level : 1
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

function renderBlock(block: MinutesBlock, key: React.Key, isFirst: boolean): ReactNode {
  switch (block.type) {
    case 'heading':
      return renderHeading(block, key, isFirst)
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

export function PortalMinutesDocument({ md }: PortalMinutesDocumentProps): ReactNode {
  // 本文が変わらないかぎり組み立て直さない。議事録が長いと変換は同期で重くなる
  // (実測: 約300KB・4,000ブロックで 17ms。相手先の端末はこれより遅い)ので、
  // 画面のほかの操作による描き直しのたびに走らせない。
  const nodes = useMemo<ReactNode[] | null>(() => {
    if (!md || !md.trim()) return null
    // JSX の組み立て自体は try の外で行う(ESLint react-hooks/error-boundaries の
    // 指摘どおり、try/catch の中で JSX を作っても React のレンダリング時の例外は
    // 捕まえられない)。ここで捕まえたいのは Markdown → ブロック木への変換の失敗。
    try {
      return renderBlocks(stripInternalLinks(parseMinutesMarkdown(md), APP_HOST), true)
    } catch {
      return null
    }
  }, [md])

  if (!md || !md.trim()) return null

  if (nodes === null) {
    // 変換に失敗しても画面を落とさない。元の見た目(生テキスト)に戻すだけ
    return <div className="whitespace-pre-wrap text-sm text-gray-700">{md}</div>
  }
  return <div>{nodes}</div>
}
