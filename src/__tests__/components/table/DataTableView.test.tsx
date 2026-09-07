import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { DataTableView } from '@/components/table/DataTableView'
import type { TableData } from '@/lib/table/parseDelimited'

// jsdom では要素に高さが無く仮想化が 0 行になるため、全行を返す軽いモックに置き換える
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 36,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        key: index,
        index,
        start: index * 36,
        size: 36,
      })),
    measureElement: () => {},
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

function bodyCells(col: number): string[] {
  return screen.getAllByTestId('table-row').map((row) => within(row).getAllByRole('cell')[col].textContent ?? '')
}

describe('DataTableView 表示', () => {
  it('見出しと全行を表示し、件数を出す', () => {
    render(<DataTableView data={data} />)
    expect(screen.getByRole('columnheader', { name: /会社名/ })).toBeInTheDocument()
    expect(screen.getAllByTestId('table-row')).toHaveLength(3)
    expect(screen.getByTestId('table-row-count')).toHaveTextContent('3件')
  })

  it('行番号を左端に出す', () => {
    render(<DataTableView data={data} />)
    const first = screen.getAllByTestId('table-row')[0]
    expect(within(first).getByTestId('table-row-number')).toHaveTextContent('1')
  })

  it('行が無いときは空メッセージ', () => {
    render(<DataTableView data={{ columns: ['a'], rows: [] }} />)
    expect(screen.getByText('表に行がありません')).toBeInTheDocument()
  })
})

describe('DataTableView 並べ替え', () => {
  it('見出しをクリックすると昇順 → 降順 → 元の順に切り替わる', () => {
    render(<DataTableView data={data} />)
    const header = screen.getByRole('columnheader', { name: /商談件数/ })
    const button = within(header).getByRole('button')

    fireEvent.click(button)
    expect(bodyCells(2)).toEqual(['0', '1', '12'])
    expect(header).toHaveAttribute('aria-sort', 'ascending')

    fireEvent.click(button)
    expect(bodyCells(2)).toEqual(['12', '1', '0'])
    expect(header).toHaveAttribute('aria-sort', 'descending')

    fireEvent.click(button)
    expect(bodyCells(2)).toEqual(['1', '0', '12'])
    expect(header).not.toHaveAttribute('aria-sort')
  })
})

describe('DataTableView 絞り込み', () => {
  it('検索語を入れると含む行だけになり、件数が「n件 / 全m件」になる', () => {
    render(<DataTableView data={data} />)
    fireEvent.change(screen.getByPlaceholderText('表の中を検索'), { target: { value: '広島' } })
    expect(screen.getAllByTestId('table-row')).toHaveLength(2)
    expect(screen.getByTestId('table-row-count')).toHaveTextContent('2件 / 全3件')
  })

  it('一致なしのときは「該当する行がありません」', () => {
    render(<DataTableView data={data} />)
    fireEvent.change(screen.getByPlaceholderText('表の中を検索'), { target: { value: 'zzz' } })
    expect(screen.getByText('該当する行がありません')).toBeInTheDocument()
  })
})
