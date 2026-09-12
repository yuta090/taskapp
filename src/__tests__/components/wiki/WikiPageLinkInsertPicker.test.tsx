import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WikiPageLinkInsertPicker } from '@/components/wiki/WikiPageLinkInsertPicker'

const mockPages = [
  { id: 'w1', title: 'キックオフ議事録' },
  { id: 'w2', title: '仕様メモ' },
  { id: 'w3', title: '議事録テンプレ' },
]

// 件数を変えるテストがあるので、モックは呼ばれた時点のこの変数を読む
let pagesForTest: { id: string; title: string }[] = mockPages

vi.mock('@/lib/hooks/useWikiPages', () => ({
  useWikiPages: () => ({ pages: pagesForTest, loading: false }),
}))

describe('WikiPageLinkInsertPicker', () => {
  beforeEach(() => {
    pagesForTest = mockPages
  })

  it('Wiki ページの一覧を表示し、押すと onSelect にページを渡す', () => {
    const onSelect = vi.fn()
    render(<WikiPageLinkInsertPicker orgId="o1" spaceId="s1" onSelect={onSelect} />)

    expect(screen.getByText('キックオフ議事録')).toBeTruthy()
    expect(screen.getByText('仕様メモ')).toBeTruthy()

    fireEvent.click(screen.getByText('仕様メモ'))
    expect(onSelect).toHaveBeenCalledWith({ id: 'w2', title: '仕様メモ' })
  })

  it('名前で絞り込める', () => {
    render(<WikiPageLinkInsertPicker orgId="o1" spaceId="s1" onSelect={vi.fn()} />)
    fireEvent.change(screen.getByTestId('wiki-page-link-insert-picker-input'), {
      target: { value: 'キックオフ' },
    })
    expect(screen.getByText('キックオフ議事録')).toBeTruthy()
    expect(screen.queryByText('仕様メモ')).toBeNull()
  })

  it('excludePageId で指定したページを候補から外す', () => {
    render(<WikiPageLinkInsertPicker orgId="o1" spaceId="s1" onSelect={vi.fn()} excludePageId="w2" />)
    expect(screen.getByText('キックオフ議事録')).toBeTruthy()
    expect(screen.getByText('議事録テンプレ')).toBeTruthy()
    expect(screen.queryByText('仕様メモ')).toBeNull()
  })

  it('excludePageId で外したあとの件数で「ほか N 件」を数える', () => {
    // 一覧に出すのは8件まで。10件から1件を除いた9件なら、隠れるのは1件だけになる
    // （除外が省略の件数にも効いていることの確認。効いていないと「ほか 2 件」になる）
    pagesForTest = Array.from({ length: 10 }, (_, i) => ({ id: `p${i + 1}`, title: `ページ${i + 1}` }))
    render(<WikiPageLinkInsertPicker orgId="o1" spaceId="s1" onSelect={vi.fn()} excludePageId="p1" />)
    expect(screen.getByText('ほか 1 件。言葉を足すと絞り込めます')).toBeTruthy()
    expect(screen.queryByText('ページ1')).toBeNull()
  })

  it('候補が8件までのときは「ほか N 件」を出さない', () => {
    render(<WikiPageLinkInsertPicker orgId="o1" spaceId="s1" onSelect={vi.fn()} excludePageId="w2" />)
    expect(screen.queryByText(/ほか/)).toBeNull()
  })
})
