/**
 * 同時編集の「種まき」— 列の本文（Markdown）から、同時編集の器（Y.Doc）を作る。
 *
 * ここがこの機能でいちばん踏みやすい穴（COEDITING_SPEC 5.3）。2人が同時に議事録を
 * 開き、それぞれが列の本文から**別々に**器を作って合流すると、本文が丸ごと二重になる。
 *
 * 防ぎ方: **同じ本文からは byte 単位で同じ更新を作る**。Yjs は「誰が(clientID)・
 * 何番目に(clock)」で構造体を見分け、同じものは重複として捨てる。そこで
 *   - 器の clientID を本文のハッシュに固定する
 *   - ブロックの id も本文のハッシュから順番に振る（既定は毎回ランダムな UUID）
 * の2つを揃える。どちらが欠けても、同じ本文から作った2つの種が別物になり二重になる。
 *
 * React も DOM も参照しない。ProseMirror のスキーマ（pmSchema）は呼び出し側が
 * 生きているエディタから渡す（全員が同じ `useMinutesSchema` を使うので同じ形になる）。
 */
import * as Y from 'yjs'
import { blockToNode } from '@blocknote/core'
import type { StyleSchema } from '@blocknote/core'
import { prosemirrorToYXmlFragment } from 'y-prosemirror'
import type { Schema } from 'prosemirror-model'
import { parseMinutesMarkdown } from '@/lib/minutes/markdown'
import { MINUTES_FRAGMENT_NAME, minutesSeedHash, seedClientId } from './hash'

// ハッシュ・チャネル内の名前・持ち主の番号は `hash.ts`（依存ゼロ）に置いてある。
// ここから再び出すと、取り込んだ側が BlockNote 一式まで引きずり込むので、**再輸出しない**。

/**
 * ブロックに決まった id を振る（入れ子も辿る）。
 *
 * BlockNote は id の無いブロックに**毎回ランダムな UUID** を振る。そのままだと
 * 同じ本文から作った種でも中身が違う構造体になり、合流したときに二重になる。
 * 見た目を既定の id（UUID）と揃えるため、同じ 8-4-4-4-12 の形にする。
 */
function assignSeedIds(blocks: unknown[], seedHash: string): unknown[] {
  let counter = 0
  const nextId = (): string => {
    const a = minutesSeedHash(`${seedHash}:${counter}`)
    const b = minutesSeedHash(`${counter}:${seedHash}`)
    counter += 1
    const hex = `${a}${b}` // 32桁
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
  }
  const walk = (list: unknown[]): unknown[] =>
    list.map((raw) => {
      const block = raw as { id?: string; children?: unknown[] }
      const withId = { ...block, id: block.id ?? nextId() }
      if (Array.isArray(block.children) && block.children.length > 0) {
        withId.children = walk(block.children)
      }
      return withId
    })
  return walk(blocks)
}

/** 本文が空のときに置く1段落。id も決まった値にする */
function emptyParagraph(seedHash: string): unknown {
  return assignSeedIds([{ type: 'paragraph', content: [] }], seedHash)[0]
}

/**
 * 本文から種（Y.Doc への更新）を作る。同じ本文からは必ず同じ byte 列になる。
 *
 * @param markdown   列（`meetings.minutes_md`）の本文
 * @param pmSchema   生きているエディタの `editor.pmSchema`
 * @param styleSchema 生きているエディタのスキーマの `styleSchema`
 */
export function buildMinutesSeed(
  markdown: string,
  pmSchema: Schema,
  styleSchema: StyleSchema
): { update: Uint8Array; seedHash: string } {
  const seedHash = minutesSeedHash(markdown)
  const parsed = parseMinutesMarkdown(markdown) as unknown[]
  const blocks = parsed.length > 0 ? assignSeedIds(parsed, seedHash) : [emptyParagraph(seedHash)]

  const doc = new Y.Doc()
  // 構造体の持ち主を本文で決める。Yjs は (clientID, clock) が同じものを重複として捨てる
  doc.clientID = seedClientId(seedHash)
  const fragment = doc.getXmlFragment(MINUTES_FRAGMENT_NAME)

  const node = pmSchema.nodeFromJSON({
    type: 'doc',
    content: [
      {
        type: 'blockGroup',
        content: blocks.map((block) => blockToNode(block as never, pmSchema, styleSchema).toJSON()),
      },
    ],
  })
  prosemirrorToYXmlFragment(node, fragment)

  return { update: Y.encodeStateAsUpdate(doc), seedHash }
}

/**
 * 器に種をまく。既に同じ本文の種が入っていれば、Yjs 側で重複として捨てられるので
 * 二重にはならない。
 */
export function seedMinutesDoc(
  doc: Y.Doc,
  markdown: string,
  pmSchema: Schema,
  styleSchema: StyleSchema
): string {
  const { update, seedHash } = buildMinutesSeed(markdown, pmSchema, styleSchema)
  Y.applyUpdate(doc, update)
  return seedHash
}
