import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PortalMinutesDocument } from '@/components/portal/PortalMinutesDocument'

// 相手先ポータルの議事録を「読める文書」として組み立てる部品。
// BlockNote は使わず(ポータルを軽く保つ)、Markdown → 独自ブロック木 → React 要素の
// 一方向の読み取り専用変換だけを行う。編集はしない。

describe('PortalMinutesDocument', () => {
  it('見出し3階層を h2/h3/h4 として描く', () => {
    const md = ['# 大見出し', '## 中見出し', '### 小見出し'].join('\n')
    render(<PortalMinutesDocument md={md} />)
    expect(screen.getByRole('heading', { level: 2, name: '大見出し' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: '中見出し' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 4, name: '小見出し' })).toBeInTheDocument()
  })

  it('連続する箇条書きを1つの ul にまとめる', () => {
    const md = ['- 項目1', '- 項目2', '- 項目3'].join('\n')
    const { container } = render(<PortalMinutesDocument md={md} />)
    const lists = container.querySelectorAll('ul')
    expect(lists.length).toBe(1)
    expect(lists[0].querySelectorAll('li').length).toBe(3)
  })

  it('入れ子の箇条書きを子リストとして描く', () => {
    const md = ['- 親', '  - 子1', '  - 子2'].join('\n')
    const { container } = render(<PortalMinutesDocument md={md} />)
    const outerLis = container.querySelectorAll(':scope > div > ul > li')
    expect(outerLis.length).toBe(1)
    const nestedLis = outerLis[0].querySelectorAll('ul li')
    expect(nestedLis.length).toBe(2)
  })

  it('チェック項目を済/未のアイコン付きで描く', () => {
    const md = ['- [x] 済んだこと', '- [ ] まだのこと'].join('\n')
    const { container } = render(<PortalMinutesDocument md={md} />)
    expect(screen.getByText('済んだこと')).toBeInTheDocument()
    expect(screen.getByText('まだのこと')).toBeInTheDocument()
    // Phosphor アイコンは svg。チェック済みと未の2つの li に1つずつ svg が付く
    const items = container.querySelectorAll('li')
    expect(items.length).toBe(2)
    items.forEach((li) => {
      expect(li.querySelector('svg')).not.toBeNull()
    })
  })

  it('表のヘッダ行を th で描く', () => {
    const md = ['| 名前 | 値 |', '| --- | --- |', '| a | 1 |'].join('\n')
    const { container } = render(<PortalMinutesDocument md={md} />)
    const ths = container.querySelectorAll('table th')
    expect(ths.length).toBe(2)
    expect(ths[0].textContent).toBe('名前')
    const tds = container.querySelectorAll('table td')
    expect(tds.length).toBe(2)
    expect(tds[0].textContent).toBe('a')
  })

  it('フェンスをコードブロックとして描く', () => {
    const md = ['```', 'const x = 1', '```'].join('\n')
    const { container } = render(<PortalMinutesDocument md={md} />)
    const pre = container.querySelector('pre code')
    expect(pre?.textContent).toBe('const x = 1')
  })

  it('太字・コード・取り消し線を描く', () => {
    const md = '**太字** と `コード` と ~~取り消し~~'
    const { container } = render(<PortalMinutesDocument md={md} />)
    expect(container.querySelector('strong')?.textContent).toBe('太字')
    expect(container.querySelector('code')?.textContent).toBe('コード')
    expect(container.querySelector('s')?.textContent).toBe('取り消し')
  })

  it('外部リンクは rel=noopener noreferrer 付きの a になる', () => {
    const md = '[公式サイト](https://example.com)'
    render(<PortalMinutesDocument md={md} />)
    const a = screen.getByRole('link', { name: '公式サイト' })
    expect(a).toHaveAttribute('href', 'https://example.com')
    expect(a).toHaveAttribute('target', '_blank')
    expect(a).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('社内向けの相対リンクは a にならず文字として出る', () => {
    const md = '[議事録の仕様](/00000000-0000-0000-0000-000000000001/project/x/wiki/y) を参照'
    const { container } = render(<PortalMinutesDocument md={md} />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(container.textContent).toContain('議事録の仕様')
    expect(container.textContent).toContain('を参照')
  })

  it('タスク化の目印(<!--task:uuid-->)は画面に出ない', () => {
    const md = '- [ ] SPEC(担当:太郎): やること <!--task:11111111-1111-1111-1111-111111111111-->'
    const { container } = render(<PortalMinutesDocument md={md} />)
    expect(container.textContent).not.toContain('task:')
    expect(container.textContent).not.toContain('11111111')
  })

  it('行末以外に残った社内の目印(HTMLコメント)も画面に出さない', () => {
    // パーサーが目印として拾うのは1行目の行末だけ。AI/CLI が書いた議事録では
    // 表のセルや行の途中に残ることがあるので、コメントの形はまとめて落とす。
    const md = ['| やること | 担当 |', '| --- | --- |', '| 見積を出す <!--task:33333333-3333-3333-3333-333333333333--> | 佐藤 |'].join('\n')
    const { container } = render(<PortalMinutesDocument md={md} />)
    expect(container.textContent).toContain('見積を出す')
    expect(container.textContent).not.toContain('task:')
    expect(container.textContent).not.toContain('33333333')
  })

  it('箇条書き・表のセルの中の改行をそのまま見せる', () => {
    const md = ['- やること', '  補足の行', '', '| a | b |', '| --- | --- |', '| 1行目<br>2行目 | x |'].join('\n')
    const { container } = render(<PortalMinutesDocument md={md} />)
    const li = container.querySelector('li')
    expect(li?.className).toContain('whitespace-pre-wrap')
    expect(li?.textContent).toContain('補足の行')
    const td = container.querySelector('td')
    expect(td?.className).toContain('whitespace-pre-wrap')
    expect(td?.textContent).toContain('2行目')
  })

  it('空の議事録は null を返す(何も描かない)', () => {
    const { container: empty } = render(<PortalMinutesDocument md="" />)
    expect(empty.firstChild).toBeNull()
    const { container: blank } = render(<PortalMinutesDocument md={'   \n  '} />)
    expect(blank.firstChild).toBeNull()
  })

  it('変換が例外を投げても落ちず、元の文字列を表示する', async () => {
    const markdownModule = await import('@/lib/minutes/markdown')
    const spy = vi.spyOn(markdownModule, 'parseMinutesMarkdown').mockImplementation(() => {
      throw new Error('boom')
    })
    render(<PortalMinutesDocument md="生の文字列がそのまま出る" />)
    expect(screen.getByText('生の文字列がそのまま出る')).toBeInTheDocument()
    spy.mockRestore()
  })
})
