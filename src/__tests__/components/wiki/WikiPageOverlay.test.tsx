import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

/**
 * 議事録の中の Wiki リンクを、画面を移らずに重ねて開く。
 * 右パネル(400px)では資料が読みにくいので、議事録の上に広く重ねる（UIルールの例外）。
 * この段階では読むだけ。直すときは「Wikiで開く」で Wiki 画面へ移る。
 */

const detailMock = vi.fn()
vi.mock('@/lib/hooks/useWikiPageDetail', () => ({
  useWikiPageDetail: (...a: unknown[]) => detailMock(...a),
}))
const editorProps = vi.fn()
vi.mock('@/components/wiki/WikiEditorDynamic', () => ({
  WikiEditorDynamic: (props: { initialContent?: string; editable?: boolean }) => {
    editorProps(props)
    return <div data-testid="wiki-editor">{props.initialContent}</div>
  },
}))

import { WikiPageOverlay } from '@/components/wiki/WikiPageOverlay'

const PAGE = { id: 'w1', title: '見積もりの前提', body: '[本文]' }

function renderOverlay(onClose = vi.fn()) {
  render(<WikiPageOverlay orgId="o" spaceId="s" pageId="w1" onClose={onClose} />)
  return onClose
}

beforeEach(() => {
  detailMock.mockReset()
  editorProps.mockReset()
  detailMock.mockReturnValue({ page: PAGE, loading: false, error: null })
})

describe('WikiPageOverlay', () => {
  it('ページの題名と本文を、読むだけの形で出す', () => {
    renderOverlay()
    expect(screen.getByRole('dialog', { name: '見積もりの前提' })).toBeTruthy()
    expect(screen.getByTestId('wiki-editor').textContent).toBe('[本文]')
    expect(editorProps.mock.calls.at(-1)![0].editable).toBe(false)
    expect(detailMock).toHaveBeenCalledWith('o', 'w1')
  })

  it('「Wikiで開く」は Wiki 画面のそのページへのリンク', () => {
    renderOverlay()
    expect(screen.getByRole('link', { name: /Wikiで開く/ }).getAttribute('href')).toBe('/o/project/s/wiki?page=w1')
  })

  it('×・Escキー・外側のクリックで閉じる', () => {
    const onClose = renderOverlay()
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByTestId('wiki-overlay-backdrop'))
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('日本語の変換を確定する Esc では閉じない', () => {
    const onClose = renderOverlay()
    fireEvent.keyDown(document, { key: 'Escape', isComposing: true })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('読み込み中・見つからないときはそう出す', () => {
    detailMock.mockReturnValue({ page: null, loading: true, error: null })
    const { unmount } = render(<WikiPageOverlay orgId="o" spaceId="s" pageId="w1" onClose={vi.fn()} />)
    expect(screen.getByText('読み込み中…')).toBeTruthy()
    unmount()
    detailMock.mockReturnValue({ page: null, loading: false, error: null })
    renderOverlay()
    expect(screen.getByText(/見つかりませんでした/)).toBeTruthy()
  })
})
