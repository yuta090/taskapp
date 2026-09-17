import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { WikiPageInspector } from '@/components/wiki/WikiPageInspector'
import type { WikiPage } from '@/types/database'

// 右のページ情報パネルから Wiki ページを PDF にする導線。
// 作りはブラウザの印刷を借りる形で、押すと印刷の画面が開く（保存先で PDF を選ぶ）。
// 「紙に何を載せるか」の指定は globals.css の @media print 側にあり、
// そちらは WikiPageClient.printPdf.test.tsx で検査する。

function page(overrides: Partial<WikiPage> = {}): WikiPage {
  return {
    id: 'page-1',
    org_id: 'org1',
    space_id: 'space1',
    title: 'ページA',
    body: '',
    tags: [],
    parent_page_id: null,
    milestone_id: null,
    pinned_at: null,
    sort_order: null,
    created_by: 'user1',
    updated_by: 'user1',
    created_at: '2026-09-01T00:00:00+09:00',
    updated_at: '2026-09-01T00:00:00+09:00',
    ...overrides,
  }
}

const printMock = vi.fn()

beforeEach(() => {
  printMock.mockReset()
  // jsdom の window.print は呼ぶと「未実装」で落ちるので差し替える
  Object.defineProperty(window, 'print', { value: printMock, writable: true, configurable: true })
})

describe('WikiPageInspector — PDFで保存', () => {
  it('ページ情報パネルに「PDFで保存」ボタンが出る', () => {
    render(<WikiPageInspector page={page()} onClose={vi.fn()} onUpdate={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'PDFで保存' })).toBeInTheDocument()
  })

  it('押すと印刷の画面が開く', () => {
    render(<WikiPageInspector page={page()} onClose={vi.fn()} onUpdate={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'PDFで保存' }))

    expect(printMock).toHaveBeenCalledTimes(1)
  })

  it('編集できない人（閲覧者・相手先）にも出る。読むだけの人も控えを持ち帰れる', () => {
    render(<WikiPageInspector page={page()} onClose={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'PDFで保存' })).toBeInTheDocument()
  })
})
