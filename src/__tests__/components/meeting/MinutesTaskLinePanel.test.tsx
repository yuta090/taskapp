import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MinutesTaskLinePanel } from '@/components/meeting/MinutesTaskLinePanel'

const ORG_ID = 'org-1'
const SPACE_ID = 'space-1'

const PAGES = [
  { id: 'page-1', title: '新社屋の間取り', tags: ['仕様書'] },
  { id: 'page-2', title: '雑メモ', tags: [] },
]

const mockCreatePage = vi.fn(async ({ title }: { title: string }) => ({
  id: 'page-new',
  title,
  tags: [] as string[],
}))

vi.mock('@/lib/hooks/useWikiPages', () => ({
  useWikiPages: () => ({
    pages: PAGES,
    loading: false,
    error: null,
    createPage: mockCreatePage,
  }),
}))

function setup() {
  const onInsert = vi.fn()
  const onClose = vi.fn()
  render(
    <MinutesTaskLinePanel orgId={ORG_ID} spaceId={SPACE_ID} onInsert={onInsert} onClose={onClose} />
  )
  return { onInsert, onClose }
}

describe('タスクにする行のパネル', () => {
  // jsdom は scrollIntoView を持っていないので、呼ばれたことだけ見られるように差し替える
  const scrollIntoView = vi.fn()
  const originalScrollIntoView = Element.prototype.scrollIntoView

  beforeEach(() => {
    mockCreatePage.mockClear()
    scrollIntoView.mockClear()
    Element.prototype.scrollIntoView = scrollIntoView
  })

  afterEach(() => {
    Element.prototype.scrollIntoView = originalScrollIntoView
  })

  /**
   * パネルは本文のいちばん下に出る。長い議事録の途中で「/」から呼ぶと画面の外にいて、
   * 「選んでも何も起きない」ように見えていた（ユーザー報告・2026-09-15）。
   * 開いた側から画面を寄せて、そのまま打ち始められるところまで面倒を見る。
   */
  it('開いたら、その場所まで画面を寄せて「やること」に手を移す', () => {
    setup()
    expect(scrollIntoView).toHaveBeenCalled()
    expect(screen.getByTestId('minutes-task-line-title')).toHaveFocus()
  })

  it('やることが空のうちは入れられない', () => {
    setup()
    expect(screen.getByTestId('minutes-task-line-submit')).toBeDisabled()
  })

  it('やることだけ書いて入れられる', () => {
    const { onInsert } = setup()
    fireEvent.change(screen.getByTestId('minutes-task-line-title'), { target: { value: '見積を出す' } })
    fireEvent.click(screen.getByTestId('minutes-task-line-submit'))
    expect(onInsert).toHaveBeenCalledWith({ title: '見積を出す', due: undefined, page: undefined })
  })

  it('期限も一緒に渡す', () => {
    const { onInsert } = setup()
    fireEvent.change(screen.getByTestId('minutes-task-line-title'), { target: { value: '見積を出す' } })
    fireEvent.change(screen.getByTestId('minutes-task-line-due'), { target: { value: '2026-09-20' } })
    fireEvent.click(screen.getByTestId('minutes-task-line-submit'))
    expect(onInsert).toHaveBeenCalledWith({ title: '見積を出す', due: '2026-09-20', page: undefined })
  })

  it('Enter でも入れられる', () => {
    const { onInsert } = setup()
    const input = screen.getByTestId('minutes-task-line-title')
    fireEvent.change(input, { target: { value: '見積を出す' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onInsert).toHaveBeenCalled()
  })

  it('「やめる」で閉じる', () => {
    const { onClose } = setup()
    fireEvent.click(screen.getByTestId('minutes-task-line-cancel'))
    expect(onClose).toHaveBeenCalled()
  })

  it('資料を選ぶと一緒に渡す', () => {
    const { onInsert } = setup()
    fireEvent.change(screen.getByTestId('minutes-task-line-title'), { target: { value: '間取りを決める' } })
    const search = screen.getByTestId('minutes-task-line-wiki-page-input')
    fireEvent.change(search, { target: { value: '新社屋' } })
    fireEvent.click(screen.getByText('新社屋の間取り'))
    fireEvent.click(screen.getByTestId('minutes-task-line-submit'))
    expect(onInsert).toHaveBeenCalledWith({
      title: '間取りを決める',
      due: undefined,
      page: { id: 'page-1', title: '新社屋の間取り' },
    })
  })

  it('「仕様書として扱う」ページを選ぶと、決定事項のタスクになると伝える', () => {
    setup()
    const search = screen.getByTestId('minutes-task-line-wiki-page-input')
    fireEvent.change(search, { target: { value: '新社屋' } })
    fireEvent.click(screen.getByText('新社屋の間取り'))
    expect(screen.getByTestId('minutes-task-line-spec-note')).toBeInTheDocument()
  })

  it('仕様書でないページなら、その断りは出さない', () => {
    setup()
    const search = screen.getByTestId('minutes-task-line-wiki-page-input')
    fireEvent.change(search, { target: { value: '雑メモ' } })
    fireEvent.click(screen.getByText('雑メモ'))
    expect(screen.queryByTestId('minutes-task-line-spec-note')).not.toBeInTheDocument()
  })
})
