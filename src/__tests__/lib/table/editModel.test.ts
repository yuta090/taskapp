import { describe, it, expect } from 'vitest'
import {
  setCell,
  insertRow,
  deleteRow,
  insertColumn,
  deleteColumn,
  renameColumn,
  nextColumnName,
} from '@/lib/table/editModel'
import type { TableData } from '@/lib/table/parseDelimited'

function sample(): TableData {
  return {
    columns: ['会社名', '都道府県', '商談件数'],
    rows: [
      ['A社', '広島県', '1'],
      ['B社', '島根県', '0'],
      ['C社', '岡山県', '12'],
    ],
  }
}

describe('setCell', () => {
  it('指定したセルだけ書き換えた新しい表を返す', () => {
    const next = setCell(sample(), 1, 2, '5')
    expect(next.rows[1]).toEqual(['B社', '島根県', '5'])
    expect(next.rows[0]).toEqual(['A社', '広島県', '1'])
  })

  it('元の表を変更しない', () => {
    const data = sample()
    const before = JSON.stringify(data)
    setCell(data, 0, 0, 'X')
    expect(JSON.stringify(data)).toBe(before)
  })

  it('触っていない行は同じ配列を使い回す(描画のむだを避けるため)', () => {
    const data = sample()
    const next = setCell(data, 1, 0, 'X')
    expect(next.rows[0]).toBe(data.rows[0])
    expect(next.rows[2]).toBe(data.rows[2])
    expect(next.rows[1]).not.toBe(data.rows[1])
  })

  it('同じ値を入れ直したときは、同じ表をそのまま返す(保存を起こさない)', () => {
    const data = sample()
    expect(setCell(data, 0, 0, 'A社')).toBe(data)
  })

  it('範囲外の行・列を指定されたら何もしない', () => {
    const data = sample()
    expect(setCell(data, 9, 0, 'X')).toBe(data)
    expect(setCell(data, 0, 9, 'X')).toBe(data)
    expect(setCell(data, -1, 0, 'X')).toBe(data)
  })

  it('列より短い行に書き込めるよう、足りないセルは空文字で埋める', () => {
    const data: TableData = { columns: ['a', 'b', 'c'], rows: [['1']] }
    expect(setCell(data, 0, 2, 'X').rows[0]).toEqual(['1', '', 'X'])
  })
})

describe('insertRow / deleteRow', () => {
  it('指定位置に空の行を差し込む', () => {
    const next = insertRow(sample(), 1)
    expect(next.rows).toHaveLength(4)
    expect(next.rows[1]).toEqual(['', '', ''])
    expect(next.rows[2]).toEqual(['B社', '島根県', '0'])
  })

  it('末尾に足せる(行数と同じ位置を許す)', () => {
    expect(insertRow(sample(), 3).rows[3]).toEqual(['', '', ''])
  })

  it('行が1つも無い表にも足せる', () => {
    const next = insertRow({ columns: ['a', 'b'], rows: [] }, 0)
    expect(next.rows).toEqual([['', '']])
  })

  it('指定した行を消す', () => {
    const next = deleteRow(sample(), 0)
    expect(next.rows).toHaveLength(2)
    expect(next.rows[0]).toEqual(['B社', '島根県', '0'])
  })

  it('範囲外の指定では何もしない', () => {
    const data = sample()
    expect(deleteRow(data, 9)).toBe(data)
    expect(insertRow(data, 9)).toBe(data)
  })
})

describe('insertColumn / deleteColumn / renameColumn', () => {
  it('指定位置に列を差し込み、全行に空セルを入れる', () => {
    const next = insertColumn(sample(), 1)
    expect(next.columns).toEqual(['会社名', '列2', '都道府県', '商談件数'])
    expect(next.rows[0]).toEqual(['A社', '', '広島県', '1'])
  })

  it('新しい列の名前は、既にある名前と重ならないところまで番号を進める', () => {
    expect(nextColumnName(['列1', '列2'])).toBe('列3')
    expect(nextColumnName(['会社名'])).toBe('列2')
    expect(nextColumnName([])).toBe('列1')
  })

  it('指定した列を、見出しと全行から消す', () => {
    const next = deleteColumn(sample(), 1)
    expect(next.columns).toEqual(['会社名', '商談件数'])
    expect(next.rows[0]).toEqual(['A社', '1'])
  })

  it('最後の1列は消せない(表そのものが無くなるため)', () => {
    const data: TableData = { columns: ['a'], rows: [['1']] }
    expect(deleteColumn(data, 0)).toBe(data)
  })

  it('見出しの名前を変える(行はそのまま使い回す)', () => {
    const data = sample()
    const next = renameColumn(data, 0, '取引先')
    expect(next.columns).toEqual(['取引先', '都道府県', '商談件数'])
    expect(next.rows).toBe(data.rows)
  })

  it('見出しを空にしたときは「列N」に戻す(見出しの無い列を作らない)', () => {
    expect(renameColumn(sample(), 1, '   ').columns[1]).toBe('列2')
  })

  it('見出しの名前が変わらないときは、同じ表をそのまま返す', () => {
    const data = sample()
    expect(renameColumn(data, 0, '会社名')).toBe(data)
  })

  it('列を足しても消しても、行の中身は元の表を壊さない', () => {
    const data = sample()
    const before = JSON.stringify(data)
    insertColumn(data, 0)
    deleteColumn(data, 0)
    expect(JSON.stringify(data)).toBe(before)
  })
})
