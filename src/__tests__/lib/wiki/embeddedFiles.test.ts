import { describe, it, expect } from 'vitest'
import { extractEmbeddedFileIds } from '@/lib/wiki/embeddedFiles'

const A = '11111111-1111-1111-1111-111111111111'
const B = '22222222-2222-2222-2222-222222222222'
const C = '33333333-3333-3333-3333-333333333333'

describe('extractEmbeddedFileIds', () => {
  it('画像・ファイルのブロックに上げたファイルの id を拾う（入れ子・重複も）', () => {
    const body = JSON.stringify([
      { type: 'image', props: { url: `/api/files/${A}/download` }, children: [] },
      {
        type: 'paragraph',
        props: {},
        children: [{ type: 'file', props: { url: `/api/files/${B}/download` }, children: [] }],
      },
      { type: 'image', props: { url: `/api/files/${A}/download` }, children: [] },
    ])
    expect(extractEmbeddedFileIds(body)).toEqual([A, B])
  })

  it('文中のリンクと外部の画像は拾わない（リンク先のファイルは社内のままにする）', () => {
    const body = JSON.stringify([
      {
        type: 'paragraph',
        props: {},
        content: [{ type: 'link', href: `/api/files/${C}/download`, content: [] }],
        children: [],
      },
      { type: 'image', props: { url: 'https://example.com/a.png' }, children: [] },
    ])
    expect(extractEmbeddedFileIds(body)).toEqual([])
  })

  it('空や壊れた本文では何も拾わない', () => {
    expect(extractEmbeddedFileIds(null)).toEqual([])
    expect(extractEmbeddedFileIds('{not json')).toEqual([])
    expect(extractEmbeddedFileIds('{"type":"image"}')).toEqual([])
  })
})
