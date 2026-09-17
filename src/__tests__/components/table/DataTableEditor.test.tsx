import React, { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { DataTableEditor } from '@/components/table/DataTableEditor'
import type { TableData } from '@/lib/table/parseDelimited'

/**
 * 表のグリッド。見るだけ(editable=false)と直せる状態を同じ部品で扱う。
 * - セルをクリック → その場で書き換え。Enter/フォーカスが外れたら確定、Esc で取り消し
 * - 行・列の追加と削除、見出しの名前の変更
 * - 保存ボタンは置かない(確定のたびに onChange で外へ渡す)
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

/** 実際の使われ方(親が持つ表を差し替える)に合わせた入れ物 */
function Harness({
  initial = data,
  onChange,
  editable = true,
}: {
  initial?: TableData
  onChange?: (next: TableData) => void
  editable?: boolean
}) {
  const [table, setTable] = useState(initial)
  return (
    <DataTableEditor
      data={table}
      editable={editable}
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

function editCell(rowIndex: number, colIndex: number, value: string, commit: 'enter' | 'escape' = 'enter') {
  fireEvent.click(cellAt(rowIndex, colIndex))
  const input = screen.getByRole('textbox')
  fireEvent.change(input, { target: { value } })
  fireEvent.keyDown(input, { key: commit === 'enter' ? 'Enter' : 'Escape' })
}

describe('DataTableEditor セルの編集', () => {
  it('セルをクリックすると、その場で書き換えられる', () => {
    render(<Harness />)
    fireEvent.click(cellAt(0, 2))
    expect(screen.getByRole('textbox')).toHaveValue('1')
  })

  it('Enter で確定し、直した表を渡す', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)

    editCell(0, 2, '5')

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0].rows[0]).toEqual(['ＪＦＥスチール株式会社', '広島県', '5'])
    expect(cellAt(0, 2)).toHaveTextContent('5')
  })

  it('Esc は取り消し。表は変わらない', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)

    editCell(0, 0, '書きかけ', 'escape')

    expect(onChange).not.toHaveBeenCalled()
    expect(cellAt(0, 0)).toHaveTextContent('ＪＦＥスチール株式会社')
  })

  it('同じ値のまま確定したときは、保存を起こさない', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)

    editCell(0, 1, '広島県')

    expect(onChange).not.toHaveBeenCalled()
  })

  it('フォーカスが外れたときも確定する(書きかけを失わない)', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)

    fireEvent.click(cellAt(1, 0))
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'アース株式会社' } })
    fireEvent.blur(input)

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(cellAt(1, 0)).toHaveTextContent('アース株式会社')
  })

  it('並べ替えたあとでも、直すのは見えている行そのもの', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)

    // 商談件数で昇順 → 先頭は 0 の「アースサポート株式会社」
    fireEvent.click(
      within(screen.getByRole('columnheader', { name: /商談件数/ })).getByRole('button', { name: /並べ替え/ })
    )
    expect(cellAt(0, 0)).toHaveTextContent('アースサポート株式会社')

    editCell(0, 2, '7')

    // 元の表の2行目(アースサポート)が書き換わる
    expect(onChange.mock.calls[0][0].rows[1]).toEqual(['アースサポート株式会社', '島根県', '7'])
  })
})

describe('DataTableEditor 行と列', () => {
  it('行を足すと、末尾に空の行が増える', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: '行を追加' }))

    expect(onChange.mock.calls[0][0].rows).toHaveLength(4)
    expect(screen.getAllByTestId('table-row')).toHaveLength(4)
  })

  it('行を消せる', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)

    const row = screen.getAllByTestId('table-row')[1]
    fireEvent.click(within(row).getByRole('button', { name: 'この行を削除' }))

    expect(onChange.mock.calls[0][0].rows).toHaveLength(2)
    expect(screen.queryByText('アースサポート株式会社')).not.toBeInTheDocument()
  })

  it('列を足すと、見出しと全行に空のセルが増える', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: '列を追加' }))

    const next: TableData = onChange.mock.calls[0][0]
    expect(next.columns).toHaveLength(4)
    expect(next.rows[0]).toHaveLength(4)
  })

  it('見出しの名前を変えられる', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)

    fireEvent.doubleClick(screen.getByRole('columnheader', { name: /会社名/ }))
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '取引先' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onChange.mock.calls[0][0].columns[0]).toBe('取引先')
  })

  it('列を消すときは、取り消せないので確認してから', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)

    const header = screen.getByRole('columnheader', { name: /都道府県/ })
    fireEvent.click(within(header).getByRole('button', { name: 'この列を削除' }))

    // 確認を求める段階では、まだ表は変わらない
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '削除' }))

    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(onChange.mock.calls[0][0].columns).toEqual(['会社名', '商談件数'])
  })
})

describe('DataTableEditor 見るだけ(editable=false)', () => {
  it('見出しと全行を表示し、件数を出す', () => {
    render(<Harness editable={false} />)
    expect(screen.getByRole('columnheader', { name: /会社名/ })).toBeInTheDocument()
    expect(screen.getAllByTestId('table-row')).toHaveLength(3)
    expect(screen.getByTestId('table-row-count')).toHaveTextContent('3件')
  })

  it('行番号を左端に出す', () => {
    render(<Harness editable={false} />)
    expect(within(screen.getAllByTestId('table-row')[0]).getByTestId('table-row-number')).toHaveTextContent('1')
  })

  it('並べ替えと検索は使える', () => {
    render(<Harness editable={false} />)

    fireEvent.click(
      within(screen.getByRole('columnheader', { name: /商談件数/ })).getByRole('button', { name: /並べ替え/ })
    )
    expect(cellAt(0, 0)).toHaveTextContent('アースサポート株式会社')

    fireEvent.change(screen.getByLabelText('表の中を検索'), { target: { value: 'Rogue' } })
    expect(screen.getAllByTestId('table-row')).toHaveLength(1)
  })

  it('書き換えの操作は出さない', () => {
    const onChange = vi.fn()
    render(<Harness editable={false} onChange={onChange} />)

    expect(screen.queryByRole('button', { name: '行を追加' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '列を追加' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'この行を削除' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'この列を削除' })).not.toBeInTheDocument()
  })

  it('セルを押しても書き換えられない', () => {
    const onChange = vi.fn()
    render(<Harness editable={false} onChange={onChange} />)

    fireEvent.click(cellAt(0, 0))
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('行が無いときは空メッセージ', () => {
    render(<Harness editable={false} initial={{ columns: ['a'], rows: [] }} />)
    expect(screen.getByText('表に行がありません')).toBeInTheDocument()
  })
})

describe('DataTableEditor 検索', () => {
  it('絞り込んだ状態でも、直すのはその行そのもの', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)

    fireEvent.change(screen.getByLabelText('表の中を検索'), { target: { value: 'Rogue' } })
    expect(screen.getAllByTestId('table-row')).toHaveLength(1)

    editCell(0, 1, '岡山県')

    expect(onChange.mock.calls[0][0].rows[2]).toEqual(['Rogue', '岡山県', '12'])
  })
})
