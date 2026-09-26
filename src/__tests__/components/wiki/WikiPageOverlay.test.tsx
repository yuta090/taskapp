import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

/**
 * 議事録の中の Wiki リンクを、画面を移らずに重ねて開く。
 * 右パネル(400px)では資料が読みにくいので、議事録の上に広く重ねる（UIルールの例外）。
 * 書ける人はその場で直せる。保存・競合の仕組みは Wiki 画面と同じもの（useWikiBodySave）を使う。
 */

const detailMock = vi.fn()
vi.mock('@/lib/hooks/useWikiPageDetail', () => ({
  useWikiPageDetail: (...a: unknown[]) => detailMock(...a),
}))
const updatePage = vi.fn()
const fetchPage = vi.fn()
const useWikiPagesMock = vi.fn()
vi.mock('@/lib/hooks/useWikiPages', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/hooks/useWikiPages')>()),
  useWikiPages: (...a: unknown[]) => {
    useWikiPagesMock(...a)
    return { updatePage, fetchPage }
  },
}))
vi.mock('@/lib/hooks/useSpaceMembers', () => ({ useSpaceMembers: () => ({ members: [] }) }))
vi.mock('@/lib/hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ user: { id: 'u1' } }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const editorProps = vi.fn()
vi.mock('@/components/wiki/WikiEditorDynamic', () => ({
  WikiEditorDynamic: (props: { initialContent?: string; editable?: boolean; onChange?: (c: string) => void }) => {
    editorProps(props)
    return (
      <div data-testid="wiki-editor">
        {props.initialContent}
        <button onClick={() => props.onChange?.('[書き直した本文]')}>打つ</button>
      </div>
    )
  },
}))

import { WikiPageOverlay } from '@/components/wiki/WikiPageOverlay'
import { WikiConflictError } from '@/lib/hooks/useWikiPages'

const PAGE = { id: 'w1', space_id: 's', title: '見積もりの前提', body: '[本文]', updated_at: '2026-09-26T00:00:00Z' }

function renderOverlay(over: { onClose?: () => void; canEdit?: boolean } = {}) {
  const onClose = over.onClose ?? vi.fn()
  render(<WikiPageOverlay orgId="o" spaceId="s" pageId="w1" canEdit={over.canEdit ?? true} onClose={onClose} />)
  return onClose
}

beforeEach(() => {
  vi.clearAllMocks()
  detailMock.mockReturnValue({ page: PAGE, loading: false, fetching: false, error: null })
  updatePage.mockResolvedValue({ updatedAt: '2026-09-26T00:00:05Z' })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('WikiPageOverlay — 読む', () => {
  it('ページの題名と本文を出す', () => {
    renderOverlay()
    expect(screen.getByRole('dialog', { name: '見積もりの前提' })).toBeTruthy()
    expect(screen.getByTestId('wiki-editor').textContent).toContain('[本文]')
    expect(detailMock).toHaveBeenCalledWith('o', 'w1')
  })

  it('空のプロジェクトで最初のページを作る処理は走らせない', () => {
    renderOverlay()
    expect(useWikiPagesMock).toHaveBeenCalledWith({ orgId: 'o', spaceId: 's', canEdit: false })
  })

  it('「Wikiで開く」は Wiki 画面のそのページへのリンク', () => {
    renderOverlay()
    expect(screen.getByRole('link', { name: /Wikiで開く/ }).getAttribute('href')).toBe('/o/project/s/wiki?page=w1')
  })

  it('×・Escキー・外側のクリックで閉じる', async () => {
    const onClose = renderOverlay()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '閉じる' })))
    await act(async () => fireEvent.keyDown(document, { key: 'Escape' }))
    await act(async () => fireEvent.click(screen.getByTestId('wiki-overlay-backdrop')))
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('日本語の変換を確定する Esc では閉じない', () => {
    const onClose = renderOverlay()
    fireEvent.keyDown(document, { key: 'Escape', isComposing: true })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('読み込み中・見つからないときはそう出す', () => {
    detailMock.mockReturnValue({ page: null, loading: true, fetching: true, error: null })
    const { unmount } = render(<WikiPageOverlay orgId="o" spaceId="s" pageId="w1" onClose={vi.fn()} />)
    expect(screen.getByText('読み込み中…')).toBeTruthy()
    unmount()
    detailMock.mockReturnValue({ page: null, loading: false, fetching: false, error: null })
    renderOverlay()
    expect(screen.getByText(/見つかりませんでした/)).toBeTruthy()
  })

  it('別のプロジェクトのページは開かない', () => {
    detailMock.mockReturnValue({ page: { ...PAGE, space_id: 'other' }, loading: false, fetching: false, error: null })
    renderOverlay()
    expect(screen.queryByTestId('wiki-editor')).toBeNull()
    expect(screen.getByText(/見つかりませんでした/)).toBeTruthy()
  })

  it('手元の古い本文を読み直している間は、エディタを出さない（古い本文を基準に書かせない）', () => {
    detailMock.mockReturnValue({ page: PAGE, loading: false, fetching: true, error: null })
    renderOverlay()
    expect(screen.queryByTestId('wiki-editor')).toBeNull()
    expect(screen.getByText('読み込み中…')).toBeTruthy()
  })
})

describe('WikiPageOverlay — その場で直す', () => {
  it('書ける人は編集できる。書けない人は読むだけ', () => {
    const { unmount } = render(<WikiPageOverlay orgId="o" spaceId="s" pageId="w1" canEdit onClose={vi.fn()} />)
    expect(editorProps.mock.calls.at(-1)![0].editable).toBe(true)
    unmount()
    renderOverlay({ canEdit: false })
    expect(editorProps.mock.calls.at(-1)![0].editable).toBe(false)
  })

  it('打った内容は1.5秒後に、開いたときの版を基準にして保存する', async () => {
    vi.useFakeTimers()
    renderOverlay()
    fireEvent.click(screen.getByText('打つ'))
    expect(screen.getByText('保存中...')).toBeTruthy()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
    expect(updatePage).toHaveBeenCalledWith('w1', { body: '[書き直した本文]' }, PAGE.updated_at)
  })

  it('閉じる前に書きかけを保存しきる', async () => {
    const onClose = vi.fn()
    renderOverlay({ onClose })
    fireEvent.click(screen.getByText('打つ'))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '閉じる' })))
    expect(updatePage).toHaveBeenCalledWith('w1', { body: '[書き直した本文]' }, PAGE.updated_at)
    expect(onClose).toHaveBeenCalled()
  })

  it('ほかの人が先に書き換えていたら帯を出し、閉じずに残る（書きかけを消さない）', async () => {
    updatePage.mockRejectedValue(new WikiConflictError())
    fetchPage.mockResolvedValue({ ...PAGE, body: '[ほかの人の本文]', updated_at: '2026-09-26T00:00:09Z' })
    const onClose = vi.fn()
    renderOverlay({ onClose })
    fireEvent.click(screen.getByText('打つ'))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '閉じる' })))
    expect(screen.getByTestId('wiki-conflict-banner')).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
    // 帯が出たあとは、控えを取ってから閉じられる
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '閉じる' })))
    expect(onClose).toHaveBeenCalled()
  })

  it('保存の通信中に閉じたら、その結果を待つ。先に書き換えられていたら閉じずに帯を出す', async () => {
    vi.useFakeTimers()
    let rejectSave: (e: Error) => void = () => {}
    updatePage.mockImplementation(() => new Promise((_, reject) => { rejectSave = reject }))
    fetchPage.mockResolvedValue({ ...PAGE, body: '[ほかの人の本文]', updated_at: '2026-09-26T00:00:09Z' })
    const onClose = vi.fn()
    renderOverlay({ onClose })
    fireEvent.click(screen.getByText('打つ'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
    expect(updatePage).toHaveBeenCalledTimes(1)

    // 通信中に×を2回押す
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
    expect(onClose).not.toHaveBeenCalled()

    await act(async () => {
      rejectSave(new WikiConflictError())
      await vi.runAllTimersAsync()
    })
    expect(screen.getByTestId('wiki-conflict-banner')).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('保存の通信中に閉じたら、保存が終わってから閉じる', async () => {
    vi.useFakeTimers()
    let resolveSave: (v: { updatedAt: string }) => void = () => {}
    updatePage.mockImplementation(() => new Promise((resolve) => { resolveSave = resolve }))
    const onClose = vi.fn()
    renderOverlay({ onClose })
    fireEvent.click(screen.getByText('打つ'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
    expect(onClose).not.toHaveBeenCalled()
    await act(async () => {
      resolveSave({ updatedAt: '2026-09-26T00:00:05Z' })
      await vi.runAllTimersAsync()
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
