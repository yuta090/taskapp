import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PickerOptionList } from '@/components/editor/PickerOptionList'

/**
 * リンクのピッカーの「検索欄＋候補の一覧」。キーボードだけで最後まで行けること。
 * 型はタスクの仕様書欄（src/components/task/WikiPageLinkPicker.tsx）に合わせている。
 */

interface Item {
  id: string
  title: string
  tags?: string[] | null
}

const ITEMS: Item[] = [
  { id: 'a', title: 'あいうえお' },
  { id: 'b', title: '画面仕様', tags: ['仕様書'] },
  { id: 'c', title: 'かきくけこ' },
]

const onSelect = vi.fn()

function renderList(props: Partial<React.ComponentProps<typeof PickerOptionList<Item>>> = {}) {
  return render(
    <PickerOptionList<Item>
      placeholder="名前で探す"
      loading={false}
      emptyMessage="ありません"
      items={ITEMS}
      renderOption={(item) => ({ label: item.title })}
      onSelect={onSelect}
      {...props}
    />
  )
}

const input = () => screen.getByTestId('app-link-picker-input')
const options = () => screen.getAllByTestId('app-link-picker-option')

beforeEach(() => {
  onSelect.mockClear()
})

describe('PickerOptionList — キーボードで選ぶ', () => {
  it('開いた直後は先頭が選ばれている', () => {
    renderList()
    expect(options()[0]).toHaveAttribute('aria-selected', 'true')
    expect(options()[1]).toHaveAttribute('aria-selected', 'false')
  })

  it('↓ で次へ、↑ で前へ動く', () => {
    renderList()
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    expect(options()[1]).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(input(), { key: 'ArrowUp' })
    expect(options()[0]).toHaveAttribute('aria-selected', 'true')
  })

  it('端では反対側に回る', () => {
    renderList()
    fireEvent.keyDown(input(), { key: 'ArrowUp' })
    expect(options()[2]).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    expect(options()[0]).toHaveAttribute('aria-selected', 'true')
  })

  it('Enter で選んでいる候補を渡す', () => {
    renderList()
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith(ITEMS[1])
  })

  it('押しても選べる（マウスと同じ結果）', () => {
    renderList()
    fireEvent.click(options()[2])
    expect(onSelect).toHaveBeenCalledWith(ITEMS[2])
  })

  it('打ち直すと先頭に戻る（前の位置に取り残されない）', () => {
    renderList()
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    fireEvent.change(input(), { target: { value: 'か' } })
    expect(options()[0]).toHaveAttribute('aria-selected', 'true')
    expect(options()).toHaveLength(1)
  })

  it('候補が無いときの Enter では何も起きない', () => {
    renderList()
    fireEvent.change(input(), { target: { value: 'ぜったいにない' } })
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.getByText('ありません')).toBeInTheDocument()
  })
})

describe('PickerOptionList — 日本語入力', () => {
  it('変換を確定する Enter では選ばない', () => {
    renderList()
    fireEvent.keyDown(input(), { key: 'Enter', isComposing: true })
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('Safari 系の keyCode 229 でも選ばない', () => {
    renderList()
    fireEvent.keyDown(input(), { key: 'Enter', keyCode: 229 })
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('変換中の ↑↓ は奪わない', () => {
    renderList()
    fireEvent.keyDown(input(), { key: 'ArrowDown', isComposing: true })
    expect(options()[0]).toHaveAttribute('aria-selected', 'true')
  })
})

describe('PickerOptionList — 読み上げソフト向け', () => {
  it('検索欄が一覧と選択中の候補を指している', () => {
    renderList()
    const box = input()
    expect(box).toHaveAttribute('role', 'combobox')
    expect(box).toHaveAttribute('aria-expanded', 'true')
    const listId = box.getAttribute('aria-controls')
    expect(listId).toBeTruthy()
    expect(document.getElementById(listId!)).toHaveAttribute('role', 'listbox')
    expect(box.getAttribute('aria-activedescendant')).toBe(options()[0].id)
  })

  it('候補が無いときは、指す先を空にする（実在しない id を指さない）', () => {
    renderList()
    fireEvent.change(input(), { target: { value: 'ぜったいにない' } })
    expect(input()).not.toHaveAttribute('aria-activedescendant')
    expect(input()).toHaveAttribute('aria-expanded', 'false')
  })

  it('読み込み中も、指す先を空にする', () => {
    renderList({ loading: true })
    expect(input()).not.toHaveAttribute('aria-activedescendant')
  })

  it('候補は Tab で降りられない（全体のショートカットが誤って効くのを防ぐ）', () => {
    renderList()
    for (const option of options()) expect(option).toHaveAttribute('tabindex', '-1')
  })
})

describe('PickerOptionList — 使い方の案内', () => {
  it('キーの案内を出す', () => {
    renderList()
    expect(screen.getByText(/↑↓/)).toBeInTheDocument()
    expect(screen.getByText(/esc/i)).toBeInTheDocument()
  })

  it('絞り込みで隠れた件数を伝える', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `x${i}`, title: `項目${i}` }))
    renderList({ items: many })
    expect(options()).toHaveLength(8)
    expect(screen.getByText(/ほか 4 件/)).toBeInTheDocument()
  })
})
