// @vitest-environment jsdom
/**
 * Wiki の同時編集の「種まき」の決定性を確かめる。
 *
 * 議事録と同じ穴（COEDITING_SPEC 5.3）: 2人がほぼ同時に同じページを開き、それぞれが
 * 列の本文から器を作ると、合流したときに本文が二重になる。Wiki の本文は Markdown ではなく
 * BlockNote のブロック JSON なので、JSON から同じ byte 列の種を作れることを確かめる。
 */
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { BlockNoteEditor, BlockNoteSchema, defaultBlockSpecs, nodeToBlock } from '@blocknote/core'
import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror'
import { buildWikiSeed } from '@/lib/collab/seed'
import { MINUTES_FRAGMENT_NAME, seedClientId } from '@/lib/collab/hash'

const schema = BlockNoteSchema.create({ blockSpecs: { ...defaultBlockSpecs } })
const editor = BlockNoteEditor.create({ schema })

function seed(body: string | null) {
  return buildWikiSeed(body, editor.pmSchema, schema.styleSchema)
}

function readBack(update: Uint8Array): { id: string; type: string; text: string }[] {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, update)
  const root = yXmlFragmentToProseMirrorRootNode(doc.getXmlFragment(MINUTES_FRAGMENT_NAME), editor.pmSchema)
  const blocks: { id: string; type: string; text: string }[] = []
  root.firstChild?.forEach((child) => {
    const block = nodeToBlock(child, editor.pmSchema, schema.blockSchema, schema.inlineContentSchema, schema.styleSchema)
    const text = Array.isArray(block.content)
      ? block.content.map((c) => ('text' in c ? c.text : '')).join('')
      : ''
    blocks.push({ id: block.id, type: block.type, text })
  })
  return blocks
}

const BODY = JSON.stringify([
  { id: 'aaaaaaaa-0000-4000-8000-000000000001', type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: '目的', styles: {} }], children: [] },
  { id: 'aaaaaaaa-0000-4000-8000-000000000002', type: 'paragraph', content: [{ type: 'text', text: '本文です', styles: {} }], children: [] },
])

describe('buildWikiSeed', () => {
  it('同じ本文からは byte 単位で同じ種になる（二重にならない）', () => {
    const a = seed(BODY)
    const b = seed(BODY)
    expect(a.seedHash).toBe(b.seedHash)
    expect(Buffer.from(a.update).equals(Buffer.from(b.update))).toBe(true)

    // 2つの器に別々にまいて合流しても、本文のかたまりは1つのまま
    const docA = new Y.Doc()
    const docB = new Y.Doc()
    Y.applyUpdate(docA, a.update)
    Y.applyUpdate(docB, b.update)
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB))
    expect(docA.getXmlFragment(MINUTES_FRAGMENT_NAME).length).toBe(1)
  })

  it('保存されているブロックの id と中身をそのまま使う', () => {
    const blocks = readBack(seed(BODY).update)
    expect(blocks).toEqual([
      { id: 'aaaaaaaa-0000-4000-8000-000000000001', type: 'heading', text: '目的' },
      { id: 'aaaaaaaa-0000-4000-8000-000000000002', type: 'paragraph', text: '本文です' },
    ])
  })

  it('id の無いブロック（DB で組み立てた本文）にも、本文から決まる同じ id を振る', () => {
    const body = JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: '追記', styles: {} }] }])
    const first = readBack(seed(body).update)
    const second = readBack(seed(body).update)
    expect(first[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(first[0].id).toBe(second[0].id)
  })

  it('本文が空・null なら、決まった id の段落を1つ置く', () => {
    for (const body of [null, '', '[]']) {
      const blocks = readBack(seed(body).update)
      expect(blocks).toHaveLength(1)
      expect(blocks[0].type).toBe('paragraph')
      expect(blocks[0].id).toBe(readBack(seed(body).update)[0].id)
    }
  })

  it('違う本文からは違う持ち主の種になる（二重を直すときに見分けられる）', () => {
    const other = JSON.stringify([{ id: 'x', type: 'paragraph', content: [], children: [] }])
    expect(seedClientId(seed(BODY).seedHash)).not.toBe(seedClientId(seed(other).seedHash))
  })

  it('JSON として読めない本文は例外にする（呼び出し側で1人用に落とす）', () => {
    expect(() => seed('{壊れている')).toThrow()
  })
})
