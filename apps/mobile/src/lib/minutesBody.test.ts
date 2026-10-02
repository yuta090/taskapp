import { describe, expect, it } from 'vitest'
import type { WikiBlock, WikiSpan } from './wikiBody'
import { parseMinutesBody } from './minutesBody'

const text = (spans: WikiSpan[]) => spans.map((s) => s.text).join('')

/** 描く文字を全部つなぐ（本文に出てはいけない印が混ざっていないかの確認用） */
function allText(blocks: WikiBlock[]): string {
  return blocks
    .map((b) => {
      const own =
        'spans' in b ? text(b.spans) : b.type === 'code' ? b.text : b.type === 'table' ? b.rows.flat().map(text).join(' ') : ''
      const kids = 'children' in b ? allText(b.children) : ''
      return `${own}\n${kids}`
    })
    .join('\n')
}

describe('parseMinutesBody', () => {
  it('null・空・空白だけは空の配列', () => {
    expect(parseMinutesBody(null)).toEqual([])
    expect(parseMinutesBody('')).toEqual([])
    expect(parseMinutesBody('  \n ')).toEqual([])
  })

  it('見出しの段を 1〜3 に収めて出す', () => {
    const blocks = parseMinutesBody('# 議題\n\n## 決定事項\n\n#### 細かい話')
    const heads = blocks.filter((b) => b.type === 'heading')
    expect(heads.map((b) => (b.type === 'heading' ? b.level : 0))).toEqual([1, 2, 3])
    expect(text((heads[0] as { spans: WikiSpan[] }).spans)).toBe('議題')
  })

  it('箇条書き・チェック・番号付きを出す', () => {
    const blocks = parseMinutesBody('- 資料を送る\n- [ ] 見積もり\n- [x] 契約\n1. 一つ目\n2. 二つ目')
    expect(blocks.map((b) => b.type)).toEqual(['bullet', 'check', 'check', 'numbered', 'numbered'])
    expect(blocks[1]).toMatchObject({ type: 'check', checked: false })
    expect(blocks[2]).toMatchObject({ type: 'check', checked: true })
    expect(blocks[4]).toMatchObject({ type: 'numbered', number: 2 })
  })

  it('表を行・列・文字で出す', () => {
    const blocks = parseMinutesBody('| 項目 | 担当 |\n| --- | --- |\n| 見積 | 田中 |')
    const table = blocks.find((b) => b.type === 'table')
    expect(table).toBeDefined()
    if (table?.type !== 'table') throw new Error('table')
    expect(table.rows.map((r) => r.map(text))).toEqual([
      ['項目', '担当'],
      ['見積', '田中'],
    ])
  })

  it('折りたたみ（<!--toggle-->）は題名と中身の入れ子で出す', () => {
    const blocks = parseMinutesBody('- <!--toggle-->詳細\n  - 中身A\n  - 中身B')
    expect(blocks).toHaveLength(1)
    const toggle = blocks[0]
    expect(toggle.type).toBe('toggle')
    if (toggle.type !== 'toggle') throw new Error('toggle')
    expect(text(toggle.spans)).toBe('詳細')
    expect(toggle.children.map((b) => (b.type === 'bullet' ? text(b.spans) : ''))).toEqual(['中身A', '中身B'])
    expect(allText(blocks)).not.toContain('toggle')
  })

  it('会議メモ（<!--note-->）は帯つきの文字と、書いた人・日時で出す', () => {
    const blocks = parseMinutesBody('<!--note:2026-10-03T14:00 田中-->先方は来週決める')
    const memo = blocks.find((b) => b.type === 'memo')
    expect(memo).toBeDefined()
    if (memo?.type !== 'memo') throw new Error('memo')
    expect(memo.band).toBe(true)
    expect(text(memo.spans)).toContain('先方は来週決める')
    expect(memo.byline).toContain('田中')
    expect(allText(blocks)).not.toContain('<!--')
  })

  it('行末の <!--task:…--> と <!--assignee:…--> は本文に出ない', () => {
    const md = [
      '- [ ] SPEC(AT-1): ログイン画面 <!--assignee:11111111-2222-3333-4444-555555555555 田中--> <!--task:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee-->',
      '- [ ] 見積もり <!--milestone:11111111-2222-3333-4444-555555555555 第1弾-->',
    ].join('\n')
    const out = allText(parseMinutesBody(md))
    expect(out).toContain('ログイン画面')
    expect(out).toContain('見積もり')
    expect(out).not.toContain('<!--')
    expect(out).not.toContain('task:')
    expect(out).not.toContain('assignee')
    expect(out).not.toContain('11111111')
  })

  it('リンクは http/https だけ開ける', () => {
    const blocks = parseMinutesBody('[公式](https://example.com/a) と [罠](javascript:alert(1))')
    const spans = (blocks[0] as { spans: WikiSpan[] }).spans
    expect(spans.find((s) => s.text === '公式')?.href).toBe('https://example.com/a')
    for (const s of spans) {
      expect(s.href === undefined || /^https?:\/\//.test(s.href)).toBe(true)
    }
    expect(spans.find((s) => s.text === '罠')?.href).toBeUndefined()
    // 危ない書き出しはリンクにならず、文字のまま残る
    expect(spans.map((s) => s.text).join('')).toContain('javascript:alert(1)')
  })

  it('太字・斜体・コードの書式を残す', () => {
    const blocks = parseMinutesBody('**重要** と *強調* と `code`')
    const spans = (blocks[0] as { spans: WikiSpan[] }).spans
    expect(spans.find((s) => s.text === '重要')?.bold).toBe(true)
    expect(spans.find((s) => s.text === '強調')?.italic).toBe(true)
    expect(spans.find((s) => s.text === 'code')?.code).toBe(true)
  })
  it('担当者とマイルストーンの印は「担当: 名前」「名前」の文字で出る', () => {
    const id = '11111111-1111-1111-1111-111111111111'
    const blocks = parseMinutesBody(`- [ ] 見積もり <!--assignee:${id} 田中--> <!--milestone:${id} 第1弾-->`)
    const text = (blocks[0] as { spans: WikiSpan[] }).spans.map((s) => s.text).join('')
    expect(text).toContain('見積もり')
    expect(text).toContain('担当: 田中')
    expect(text).toContain('第1弾')
    expect(text).not.toContain(id)
  })
})
