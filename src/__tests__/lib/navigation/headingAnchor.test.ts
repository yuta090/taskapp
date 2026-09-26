import { describe, it, expect } from 'vitest'
import {
  slugifyHeading,
  collectHeadingAnchors,
  findHeadingIdByHash,
  buildHeadingUrl,
  buildHeadingClipboard,
} from '@/lib/navigation/headingAnchor'

/** BlockNote の見出しブロック（テスト用の最小の形） */
function heading(id: string, text: string, level = 2, children: unknown[] = []) {
  return { id, type: 'heading', props: { level }, content: [{ type: 'text', text, styles: {} }], children }
}
function paragraph(id: string, text: string, children: unknown[] = []) {
  return { id, type: 'paragraph', props: {}, content: [{ type: 'text', text, styles: {} }], children }
}

describe('slugifyHeading — 見出しの文字からアンカーを作る', () => {
  it.each([
    ['1. 振り分けの結果', '1-振り分けの結果'],
    ['  前後の空白  ', '前後の空白'],
    ['空白が  続く　全角も', '空白が-続く-全角も'],
    ['Next Step', 'next-step'],
    ['「決定事項」（9/26）', '決定事項926'],
    ['A - B', 'a-b'],
    ['snake_case と ハイフン-付き', 'snake_case-と-ハイフン-付き'],
    ['・箇条の点、句読点。', '箇条の点句読点'],
  ])('%s → %s', (input, expected) => {
    expect(slugifyHeading(input)).toBe(expected)
  })

  it('記号だけの見出しは「見出し」にする（空のアンカーを作らない）', () => {
    expect(slugifyHeading('!!!')).toBe('見出し')
  })

  it('濁点が分かれて入っていても同じアンカーになる（NFC にそろえる）', () => {
    expect(slugifyHeading('がぎ')).toBe(slugifyHeading('がぎ'))
  })
})

describe('collectHeadingAnchors — 本文の見出しにアンカーを振る', () => {
  it('上から順に拾い、同じ見出しの2つ目以降に -2, -3 を付ける', () => {
    const doc = [
      heading('h1', 'まとめ'),
      paragraph('p1', '本文'),
      heading('h2', 'まとめ'),
      heading('h3', 'まとめ', 3),
    ]
    expect(collectHeadingAnchors(doc).map((h) => h.anchor)).toEqual(['まとめ', 'まとめ-2', 'まとめ-3'])
  })

  it('字下げした子ブロックの見出しも文書の順で拾う', () => {
    const doc = [paragraph('p1', '親', [heading('child', '子の見出し')]), heading('h2', '次')]
    expect(collectHeadingAnchors(doc).map((h) => h.id)).toEqual(['child', 'h2'])
  })

  it('文字の無い見出しは拾わない', () => {
    const doc = [heading('empty', '   '), heading('h1', 'あり')]
    expect(collectHeadingAnchors(doc)).toEqual([{ id: 'h1', level: 2, text: 'あり', anchor: 'あり' }])
  })

  it('もともと「-2」で終わる見出しがあっても、同じアンカーを2つ作らない', () => {
    const doc = [heading('a', 'a-2'), heading('b', 'a'), heading('c', 'a')]
    const anchors = collectHeadingAnchors(doc).map((h) => h.anchor)
    expect(new Set(anchors).size).toBe(3)
    expect(anchors).toEqual(['a-2', 'a', 'a-3'])
  })

  it('リンクの中の文字も見出しの文字に含める', () => {
    const doc = [
      {
        id: 'h1',
        type: 'heading',
        props: { level: 1 },
        content: [
          { type: 'text', text: '参照: ', styles: {} },
          { type: 'link', href: 'https://example.com', content: [{ type: 'text', text: '仕様書', styles: {} }] },
        ],
        children: [],
      },
    ]
    expect(collectHeadingAnchors(doc)[0]).toMatchObject({ text: '参照: 仕様書', anchor: '参照-仕様書', level: 1 })
  })
})

describe('findHeadingIdByHash — # の値から見出しを探す', () => {
  const anchors = collectHeadingAnchors([
    heading('block-a', '1. 振り分けの結果'),
    heading('block-b', 'まとめ'),
    heading('block-c', 'まとめ'),
  ])

  it('URL エンコードされたアンカーで見つかる', () => {
    expect(findHeadingIdByHash(anchors, '#' + encodeURIComponent('1-振り分けの結果'))).toBe('block-a')
  })

  it('# の無い値・エンコードされていない値でも見つかる', () => {
    expect(findHeadingIdByHash(anchors, 'まとめ-2')).toBe('block-c')
  })

  it('見出しの文字をそのまま書いた # でも見つかる', () => {
    expect(findHeadingIdByHash(anchors, '#1. 振り分けの結果')).toBe('block-a')
  })

  it('アンカーで見つからなければブロックIDとして探す（前からあるリンクのため）', () => {
    expect(findHeadingIdByHash(anchors, '#block-b')).toBe('block-b')
  })

  it('見つからない・空・壊れたエンコードなら null', () => {
    expect(findHeadingIdByHash(anchors, '#無い見出し')).toBeNull()
    expect(findHeadingIdByHash(anchors, '')).toBeNull()
    expect(findHeadingIdByHash(anchors, '#')).toBeNull()
    expect(findHeadingIdByHash(anchors, '#%E3%81')).toBeNull()
  })
})

describe('buildHeadingUrl — 見出しへの URL を作る', () => {
  const base = { origin: 'https://agentpm.app', pathname: '/org/project/space/wiki' }

  it('page= だけを残し、ほかのクエリ（info=1 等）は落とす', () => {
    const url = buildHeadingUrl({ ...base, search: '?info=1&page=abc&x=y' }, '1-振り分けの結果')
    expect(url).toBe(`https://agentpm.app/org/project/space/wiki?page=abc#${encodeURIComponent('1-振り分けの結果')}`)
  })

  it('議事録は meeting= を残す', () => {
    const url = buildHeadingUrl(
      { origin: 'https://agentpm.app', pathname: '/org/project/space/meetings', search: '?meeting=m1&info=1' },
      'まとめ'
    )
    expect(url).toBe(`https://agentpm.app/org/project/space/meetings?meeting=m1#${encodeURIComponent('まとめ')}`)
  })

  it('クエリが無ければ ? を付けない', () => {
    expect(buildHeadingUrl({ ...base, search: '' }, 'a')).toBe('https://agentpm.app/org/project/space/wiki#a')
  })
})

describe('buildHeadingClipboard — クリップボードに入れる2つの形', () => {
  it('text/plain は「ページ名 §見出し」と URL の2行、text/html はリンク', () => {
    const out = buildHeadingClipboard({ pageTitle: '9/26定例', headingText: 'まとめ', url: 'https://x.test/w?page=1#a' })
    expect(out.plain).toBe('9/26定例 §まとめ\nhttps://x.test/w?page=1#a')
    expect(out.html).toBe('<a href="https://x.test/w?page=1#a">9/26定例 §まとめ</a>')
  })

  it('HTML に入れる文字はエスケープする', () => {
    const out = buildHeadingClipboard({ pageTitle: 'A&B <x>', headingText: '"q"', url: 'https://x.test/?a=1&b=2' })
    expect(out.html).toBe('<a href="https://x.test/?a=1&amp;b=2">A&amp;B &lt;x&gt; §&quot;q&quot;</a>')
  })

  it('ページ名が空なら見出しだけを書く', () => {
    expect(buildHeadingClipboard({ pageTitle: '  ', headingText: 'まとめ', url: 'u' }).plain).toBe('§まとめ\nu')
  })
})
