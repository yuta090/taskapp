/**
 * 議事録の本文（`meetings.minutes_md`・Markdown）を、Wiki と同じ画面部品（WikiBody）が描くブロックの列にする。
 *
 * Web の変換（`@/lib/minutes/markdown` の parseMinutesMarkdown・DOM/React 非依存）で Markdown→BlockNote のブロックにし、
 * JSON 文字列にして `parseWikiBody` に渡す（Wiki 本文と同じ形なので、描画側を2つ持たない）。
 * 行末の `<!--task:…-->` の印は文字としては出さない。担当者・マイルストーンの印は、Web の表示（TaskMetaChip）と同じく
 * 「担当: 田中」「第1弾」の文字にして出す（content を持たないので、そのままだと名前が落ちる）。
 */
import { ASSIGNEE_MARKER_TYPE, MILESTONE_MARKER_TYPE, parseMinutesMarkdown } from '@/lib/minutes/markdown'
import { parseWikiBody, type WikiBlock } from './wikiBody'

type Raw = { type?: unknown; props?: { name?: unknown }; content?: unknown; children?: unknown }

function metaText(label: string, props: Raw['props']): { type: 'text'; text: string; styles: Record<string, never> } {
  const name = typeof props?.name === 'string' && props.name.trim() !== '' ? props.name : '不明'
  return { type: 'text', text: `${label}${name}`, styles: {} }
}

/** 担当者・マイルストーンの印を文字のインラインに置き換える（ブロックの中身・入れ子・表のセルまで） */
function withMetaText(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(withMetaText)
  if (node == null || typeof node !== 'object') return node
  const o = node as Raw & Record<string, unknown>
  if (o.type === ASSIGNEE_MARKER_TYPE) return metaText('担当: ', o.props)
  if (o.type === MILESTONE_MARKER_TYPE) return metaText('', o.props)
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o)) out[k] = k === 'content' || k === 'children' || k === 'rows' || k === 'cells' ? withMetaText(v) : v
  return out
}

export function parseMinutesBody(md: string | null): WikiBlock[] {
  if (md == null || md.trim() === '') return []
  return parseWikiBody(JSON.stringify(withMetaText(parseMinutesMarkdown(md))))
}
