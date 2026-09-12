import { describe, it, expect } from 'vitest'
import { splitTextIntoLinkParts } from '@/lib/navigation/linkifyText'

/**
 * タスクの説明文のような「ただの文字」の中から、押せるリンクにしてよい所だけを拾う。
 *
 * 拾いすぎると事故る（`9/13` や `A/B` のような普通の文字までリンクになる）ので、
 * `appLinks.ts` が作る形だけを、アプリの中のリンクとして認める。
 */
const ORG = '11111111-1111-1111-1111-111111111111'
const SPACE = '22222222-2222-2222-2222-222222222222'
const ID = '33333333-3333-3333-3333-333333333333'

describe('splitTextIntoLinkParts — アプリの中のリンク', () => {
  it('タスクのリンクを拾う', () => {
    const href = `/${ORG}/project/${SPACE}?task=${ID}`
    expect(splitTextIntoLinkParts(`参考: ${href} を見て`)).toEqual([
      { kind: 'text', value: '参考: ' },
      { kind: 'app', value: href, href },
      { kind: 'text', value: ' を見て' },
    ])
  })

  it('Wikiページ・議事録・プロジェクトのリンクも拾う', () => {
    for (const href of [
      `/${ORG}/project/${SPACE}/wiki?page=${ID}`,
      `/${ORG}/project/${SPACE}/meetings?meeting=${ID}`,
      `/${ORG}/project/${SPACE}`,
    ]) {
      expect(splitTextIntoLinkParts(href)).toEqual([{ kind: 'app', value: href, href }])
    }
  })

  it('ファイルのダウンロードは別扱いにする（画面が変わらないので新しいタブ）', () => {
    const href = `/api/files/${ID}/download`
    expect(splitTextIntoLinkParts(href)).toEqual([{ kind: 'download', value: href, href }])
  })

  it('1つの文の中に複数あっても全部拾う', () => {
    const a = `/${ORG}/project/${SPACE}?task=${ID}`
    const b = `/${ORG}/project/${SPACE}/wiki?page=${ID}`
    const parts = splitTextIntoLinkParts(`${a} と ${b}`)
    expect(parts.filter((p) => p.kind === 'app').map((p) => p.href)).toEqual([a, b])
  })
})

describe('splitTextIntoLinkParts — 外部のリンク', () => {
  it('http/https は拾う', () => {
    expect(splitTextIntoLinkParts('資料 https://example.com/a?b=1 です')).toEqual([
      { kind: 'text', value: '資料 ' },
      { kind: 'external', value: 'https://example.com/a?b=1', href: 'https://example.com/a?b=1' },
      { kind: 'text', value: ' です' },
    ])
  })

  it('末尾の句読点や閉じ括弧はリンクに含めない', () => {
    const parts = splitTextIntoLinkParts('（https://example.com/a）。')
    expect(parts.find((p) => p.kind === 'external')?.href).toBe('https://example.com/a')
  })
})

describe('splitTextIntoLinkParts — 拾ってはいけないもの', () => {
  it.each([
    ['日付', '9/13 に確認する'],
    ['ただのスラッシュ', 'A/B テストの結果'],
    ['アプリの形でないパス', '/foo/bar を見て'],
    ['UUID でない', '/abc/project/def?task=1'],
    ['危ないしくみ', 'javascript:alert(1) は無効'],
    ['別のサイトへの相対でない指定', '//example.com は無効'],
  ])('%s はリンクにしない（%s）', (_name, text) => {
    expect(splitTextIntoLinkParts(text)).toEqual([{ kind: 'text', value: text }])
  })

  it('空の文字は空の配列', () => {
    expect(splitTextIntoLinkParts('')).toEqual([])
  })

  it('改行はそのまま残す（見た目を変えない）', () => {
    expect(splitTextIntoLinkParts('1行目\n2行目')).toEqual([{ kind: 'text', value: '1行目\n2行目' }])
  })
})
