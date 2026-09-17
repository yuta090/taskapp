import React, { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { DataTableEditor } from '@/components/table/DataTableEditor'
import type { TableData } from '@/lib/table/parseDelimited'

/**
 * 表の「見せ方・触り方」の取り決め。
 * - 行の追加は**表の一番下**から（右上のツールバーではなく、書き足したい場所の近く）
 * - 長いセルは既定どおり1行で省略。切り替えると**同じ列幅のまま折り返して全文**を見せる
 * - 列の削除は取り消せないので、ゴミ箱は**その列に近づいたときだけ**出す
 * - 列の幅は見出しの境目をドラッグして変えられる
 */

// jsdom では要素に高さが無く仮想化が 0 行になるため、全行を返す軽いモックに置き換える
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 36,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({ key: index, index, start: index * 36, size: 36 })),
    measureElement: () => {},
    measure: () => {},
    scrollToIndex: () => {},
  }),
}))

const data: TableData = {
  columns: ['会社名', '都道府県', '商談件数'],
  rows: [
    ['ＪＦＥスチール株式会社', '広島県', '1'],
    ['アースサポート株式会社', '島根県', '0'],
    ['Rogue', '広島県', '12'],
  ],
}

function Harness({ initial = data, onChange }: { initial?: TableData; onChange?: (next: TableData) => void }) {
  const [table, setTable] = useState(initial)
  return (
    <DataTableEditor
      data={table}
      onChange={(next) => {
        setTable(next)
        onChange?.(next)
      }}
    />
  )
}

function cellAt(rowIndex: number, colIndex: number): HTMLElement {
  const row = screen.getAllByTestId('table-row')[rowIndex]
  return within(row).getAllByRole('cell')[colIndex]
}

/**
 * 1列目の幅を取り出す。列の並びは CSS 変数で配っている
 * （ドラッグ中に React の描き直しを起こさないため）。
 */
function firstColumnWidth(): number {
  const template = screen.getByTestId('table-grid').style.getPropertyValue('--table-grid-template')
  return Number(template.trim().split(/\s+/)[1]?.replace('px', ''))
}

describe('行の追加は表の一番下から', () => {
  it('「行を追加」は行より後ろにある(書き足したい場所の近く)', () => {
    render(<Harness />)
    const button = screen.getByRole('button', { name: '行を追加' })
    const lastRow = screen.getAllByTestId('table-row').at(-1)!

    const position = lastRow.compareDocumentPosition(button)
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('押すと末尾に空の行が増える', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: '行を追加' }))

    expect(onChange.mock.calls[0][0].rows).toHaveLength(4)
    expect(onChange.mock.calls[0][0].rows[3]).toEqual(['', '', ''])
    expect(screen.getAllByTestId('table-row')).toHaveLength(4)
  })

  it('絞り込み中に押したときは、検索を解除して足した行を見せる', () => {
    render(<Harness />)
    const search = screen.getByLabelText('表の中を検索')

    fireEvent.change(search, { target: { value: 'Rogue' } })
    expect(screen.getAllByTestId('table-row')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: '行を追加' }))

    // 空の行は検索に引っかからない。足したのに見えない、を避ける
    expect(search).toHaveValue('')
    expect(screen.getAllByTestId('table-row')).toHaveLength(4)
  })
})

describe('折り返して表示', () => {
  const longText = '一行目のながい説明\n二行目のつづき'
  const longData: TableData = { columns: ['メモ'], rows: [[longText]] }

  it('既定では1行だけ見せる(はみ出しは省略)', () => {
    render(<Harness initial={longData} />)
    expect(cellAt(0, 0)).toHaveTextContent('一行目のながい説明')
    expect(cellAt(0, 0)).not.toHaveTextContent('二行目のつづき')
  })

  it('切り替えると、同じ列幅のまま全文を見せる', () => {
    render(<Harness initial={longData} />)
    const widthBefore = firstColumnWidth()

    fireEvent.click(screen.getByRole('button', { name: '折り返して表示' }))

    expect(cellAt(0, 0)).toHaveTextContent('二行目のつづき')
    // 折り返しなので、列の幅は変わらない
    expect(firstColumnWidth()).toBe(widthBefore)
  })

  it('もう一度押すと1行の表示に戻る', () => {
    render(<Harness initial={longData} />)

    fireEvent.click(screen.getByRole('button', { name: '折り返して表示' }))
    fireEvent.click(screen.getByRole('button', { name: '1行で表示' }))

    expect(cellAt(0, 0)).not.toHaveTextContent('二行目のつづき')
  })
})

describe('列の削除ボタン', () => {
  it('普段は見えず、その列に近づいたときだけ出す(取り消せない操作のため)', () => {
    render(<Harness />)
    const header = screen.getByRole('columnheader', { name: /都道府県/ })
    const trash = within(header).getByRole('button', { name: 'この列を削除' })

    expect(trash.className).toMatch(/opacity-0/)
    expect(trash.className).toMatch(/group-hover:opacity-100/)
    // キーボードで辿ったときは見えるようにする
    expect(trash.className).toMatch(/focus-visible:opacity-100/)
  })
})

describe('列の幅の調整', () => {
  it('見出しの境目をドラッグすると、その列だけ広がる', () => {
    render(<Harness />)
    const before = firstColumnWidth()

    const handle = screen.getByRole('separator', { name: '「会社名」の幅を変える' })
    fireEvent.mouseDown(handle, { clientX: 200 })
    fireEvent.mouseMove(window, { clientX: 280 })
    fireEvent.mouseUp(window)

    expect(firstColumnWidth()).toBe(before + 80)
  })

  it('狭くしすぎない(下限で止まる)', () => {
    render(<Harness />)

    const handle = screen.getByRole('separator', { name: '「会社名」の幅を変える' })
    fireEvent.mouseDown(handle, { clientX: 200 })
    fireEvent.mouseMove(window, { clientX: -2000 })
    fireEvent.mouseUp(window)

    expect(firstColumnWidth()).toBeGreaterThanOrEqual(80)
  })

  it('ドラッグ中に離すまでは、表の中身は変わらない', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)

    const handle = screen.getByRole('separator', { name: '「会社名」の幅を変える' })
    fireEvent.mouseDown(handle, { clientX: 200 })
    fireEvent.mouseMove(window, { clientX: 300 })
    fireEvent.mouseUp(window)

    // 幅は見た目だけの話。ファイルの中身は書き換えない
    expect(onChange).not.toHaveBeenCalled()
  })
})
