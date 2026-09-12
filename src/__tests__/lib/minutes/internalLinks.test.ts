import { describe, it, expect } from 'vitest'
import { isInternalMinutesHref, stripInternalLinks } from '@/lib/minutes/internalLinks'
import { parseMinutesMarkdown, type MinutesLinkInline, type MinutesTextInline } from '@/lib/minutes/markdown'

describe('isInternalMinutesHref', () => {
  it('scheme の無い相対リンクは内部リンクと判定する', () => {
    expect(isInternalMinutesHref('/00000000-0000-0000-0000-000000000001/project/x/wiki/y')).toBe(true)
    expect(isInternalMinutesHref('./docs/a.md')).toBe(true)
    expect(isInternalMinutesHref('?q=1')).toBe(true)
  })

  it('http/https/mailto は外部リンクと判定する', () => {
    expect(isInternalMinutesHref('http://example.com')).toBe(false)
    expect(isInternalMinutesHref('https://example.com/a')).toBe(false)
    expect(isInternalMinutesHref('mailto:a@example.com')).toBe(false)
  })

  it('大文字・前後の空白があっても scheme を認識する', () => {
    expect(isInternalMinutesHref('  HTTPS://example.com  ')).toBe(false)
    expect(isInternalMinutesHref('\tmailto:a@example.com')).toBe(false)
  })

  it('空文字は内部リンク扱い(リンクにしない)', () => {
    expect(isInternalMinutesHref('')).toBe(true)
  })

  it('同じホストの絶対URL(アドレスバーからのコピー)も内部リンクと判定する', () => {
    const href = 'https://agentpm.app/00000000-0000-0000-0000-000000000001/project/x/wiki?page=y'
    expect(isInternalMinutesHref(href, 'agentpm.app')).toBe(true)
    // 大文字小文字は無視する
    expect(isInternalMinutesHref('HTTPS://AgentPM.app/a/project/b', 'agentpm.app')).toBe(true)
  })

  it('同じホストでも /portal 配下は相手先自身の画面なので外部リンク扱いにする', () => {
    expect(isInternalMinutesHref('https://agentpm.app/portal/abc/tasks', 'agentpm.app')).toBe(false)
    expect(isInternalMinutesHref('https://agentpm.app/portal', 'agentpm.app')).toBe(false)
  })

  it('別のホスト・ホスト名が分からないときは外部リンクのまま', () => {
    expect(isInternalMinutesHref('https://example.com/a/project/b', 'agentpm.app')).toBe(false)
    expect(isInternalMinutesHref('https://agentpm.app/a/project/b')).toBe(false)
    expect(isInternalMinutesHref('mailto:a@agentpm.app', 'agentpm.app')).toBe(false)
  })
})

describe('stripInternalLinks', () => {
  it('相対リンクを表示文字だけの text に置き換える', () => {
    const blocks = parseMinutesMarkdown('[議事録の仕様](/00000000-0000-0000-0000-000000000001/project/x/wiki/y) を参照')
    const stripped = stripInternalLinks(blocks)
    const content = stripped[0].content
    expect(Array.isArray(content)).toBe(true)
    const items = content as (MinutesTextInline | MinutesLinkInline)[]
    expect(items.some((it) => it.type === 'link')).toBe(false)
    expect(items.some((it) => it.type === 'text' && it.text === '議事録の仕様')).toBe(true)
  })

  it('外部リンク(http)は link のまま残す', () => {
    const blocks = parseMinutesMarkdown('[公式サイト](https://example.com)')
    const stripped = stripInternalLinks(blocks)
    const content = stripped[0].content as unknown[]
    const link = content.find((it) => (it as { type: string }).type === 'link') as MinutesLinkInline | undefined
    expect(link).toBeDefined()
    expect(link?.href).toBe('https://example.com')
  })

  it('入力のブロック木を書き換えない(新しい木を返す)', () => {
    const blocks = parseMinutesMarkdown('[相対](./a)')
    const before = JSON.parse(JSON.stringify(blocks))
    stripInternalLinks(blocks)
    expect(blocks).toEqual(before)
  })

  it('appHost を渡すと、表のセルの中の同じホストの絶対URLも文字に変える', () => {
    const md = ['| 資料 | 備考 |', '| --- | --- |', '| [仕様](https://agentpm.app/a/project/b/wiki?page=c) | 社内 |'].join('\n')
    const stripped = stripInternalLinks(parseMinutesMarkdown(md), 'agentpm.app')
    const json = JSON.stringify(stripped)
    expect(json).not.toContain('agentpm.app')
    expect(json).toContain('仕様')
  })

  it('表のセル・入れ子の箇条書きの中の相対リンクも文字に変える', () => {
    const md = ['| リンク |', '| --- |', '| [社内](/a/b) |', '', '- 親', '  - [社内子](./x)'].join('\n')
    const blocks = parseMinutesMarkdown(md)
    const stripped = stripInternalLinks(blocks)

    const table = stripped.find((b) => b.type === 'table')
    expect(table).toBeDefined()
    const tableContent = table!.content as { rows: { cells: unknown[][] }[] }
    // rows[0] はヘッダ行(見出し「リンク」)。実データは rows[1]
    const cellItems = tableContent.rows[1].cells[0] as { type: string; text?: string }[]
    expect(cellItems.some((it) => it.type === 'link')).toBe(false)
    expect(cellItems.some((it) => it.type === 'text' && it.text === '社内')).toBe(true)

    const bullet = stripped.find((b) => b.type === 'bulletListItem')
    expect(bullet).toBeDefined()
    const childContent = bullet!.children![0].content as { type: string; text?: string }[]
    expect(childContent.some((it) => it.type === 'link')).toBe(false)
    expect(childContent.some((it) => it.type === 'text' && it.text === '社内子')).toBe(true)
  })
})
