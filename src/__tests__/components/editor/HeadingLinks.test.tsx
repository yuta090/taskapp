import React, { useRef } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { HeadingLinks, type HeadingLinksEditor } from '@/components/editor/HeadingLinks'

const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('sonner', () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }))

const writeLink = vi.fn<(p: { plain: string; html: string }) => Promise<boolean>>()
vi.mock('@/lib/navigation/writeLinkToClipboard', () => ({
  writeLinkToClipboard: (p: { plain: string; html: string }) => writeLink(p),
}))

function heading(id: string, text: string) {
  return { id, type: 'heading', props: { level: 2 }, content: [{ type: 'text', text, styles: {} }], children: [] }
}

/** 本物の BlockNote が出す DOM と同じ形（.bn-block[data-id] > [data-content-type=heading] > h2） */
function FakeBody({ blocks }: { blocks: Array<{ id: string; text: string }> }) {
  return (
    <div className="bn-editor">
      {blocks.map((b) => (
        <div key={b.id} className="bn-block-outer" data-id={b.id}>
          <div className="bn-block" data-id={b.id}>
            <div className="bn-block-content" data-content-type="heading" data-level="2">
              <h2 className="bn-inline-content">{b.text}</h2>
            </div>
          </div>
        </div>
      ))}
      <div className="bn-block-outer" data-id="p1">
        <div className="bn-block" data-id="p1">
          <div className="bn-block-content" data-content-type="paragraph">
            <p className="bn-inline-content">本文</p>
          </div>
        </div>
      </div>
    </div>
  )
}

function makeEditor(doc: unknown[]) {
  const listeners = new Set<() => void>()
  const editor: HeadingLinksEditor & { emit: (d: unknown[]) => void } = {
    document: doc,
    onChange: (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    emit(d) {
      editor.document = d
      listeners.forEach((cb) => cb())
    },
  }
  return editor
}

function Harness({ editor, blocks, title = '9/26定例' }: { editor: HeadingLinksEditor; blocks: Array<{ id: string; text: string }>; title?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  return (
    <div ref={ref} data-testid="container">
      <FakeBody blocks={blocks} />
      <HeadingLinks editor={editor} containerRef={ref} pageTitle={title} />
    </div>
  )
}

const BLOCKS = [
  { id: 'b1', text: '1. 振り分けの結果' },
  { id: 'b2', text: 'まとめ' },
  { id: 'b3', text: 'まとめ' },
]
const DOC = BLOCKS.map((b) => heading(b.id, b.text))

const scrollIntoView = vi.fn()

beforeEach(() => {
  toastSuccess.mockReset()
  toastError.mockReset()
  writeLink.mockReset()
  scrollIntoView.mockReset()
  Element.prototype.scrollIntoView = scrollIntoView
  // jsdom は配置を計算しないので「画面に出ている」扱いにする
  vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList)
  window.history.replaceState(null, '', '/org/project/space/wiki?page=p-1&info=1')
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('HeadingLinks — コピーボタン', () => {
  it('見出しごとに「見出しへのリンクをコピー」ボタンを置く（キーボードで押せる button）', () => {
    render(<Harness editor={makeEditor(DOC)} blocks={BLOCKS} />)
    const buttons = screen.getAllByRole('button', { name: '見出しへのリンクをコピー' })
    expect(buttons).toHaveLength(3)
    buttons.forEach((b) => expect(b.tagName).toBe('BUTTON'))
  })

  it('マウスを乗せた見出しのボタンだけを見せる', () => {
    render(<Harness editor={makeEditor(DOC)} blocks={BLOCKS} />)
    const [first, second] = screen.getAllByRole('button', { name: '見出しへのリンクをコピー' })
    expect(first).toHaveAttribute('data-visible', 'false')
    fireEvent.mouseOver(screen.getByText('1. 振り分けの結果'))
    expect(first).toHaveAttribute('data-visible', 'true')
    expect(second).toHaveAttribute('data-visible', 'false')
    fireEvent.mouseOver(screen.getByText('本文'))
    expect(first).toHaveAttribute('data-visible', 'false')
  })

  it('押すと、ページ名 §見出し と URL（page= だけ残す・# はアンカー）をコピーしてトーストを出す', async () => {
    writeLink.mockResolvedValue(true)
    render(<Harness editor={makeEditor(DOC)} blocks={BLOCKS} />)
    const buttons = screen.getAllByRole('button', { name: '見出しへのリンクをコピー' })
    await act(async () => {
      fireEvent.click(buttons[2])
    })
    const url = `${window.location.origin}/org/project/space/wiki?page=p-1#${encodeURIComponent('まとめ-2')}`
    expect(writeLink).toHaveBeenCalledWith({
      plain: `9/26定例 §まとめ\n${url}`,
      html: `<a href="${url}">9/26定例 §まとめ</a>`,
    })
    expect(toastSuccess).toHaveBeenCalledWith('リンクをコピーしました')
  })

  it('コピーできなかったらそう伝える', async () => {
    writeLink.mockResolvedValue(false)
    render(<Harness editor={makeEditor(DOC)} blocks={BLOCKS} />)
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: '見出しへのリンクをコピー' })[0])
    })
    expect(toastError).toHaveBeenCalledWith('リンクをコピーできませんでした')
  })

  it('本文が変わったら見出しを取り直す', () => {
    const editor = makeEditor(DOC)
    render(<Harness editor={editor} blocks={BLOCKS} />)
    act(() => editor.emit([heading('b1', '1. 振り分けの結果')]))
    expect(screen.getAllByRole('button', { name: '見出しへのリンクをコピー' })).toHaveLength(1)
  })
})

describe('HeadingLinks — URL の # で見出しへ動く', () => {
  it('開いたときの # に合う見出しへ動かし、目立たせる', async () => {
    window.history.replaceState(null, '', `/org/project/space/wiki?page=p-1#${encodeURIComponent('まとめ-2')}`)
    const animate = vi.fn()
    Element.prototype.animate = animate as unknown as Element['animate']
    // 色は中央トークンから読む（本物は globals.css が入れる）
    document.documentElement.style.setProperty('--color-blue-100', 'rgb(1, 2, 3)')
    render(<Harness editor={makeEditor(DOC)} blocks={BLOCKS} />)
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1))
    const target = scrollIntoView.mock.instances[0] as Element
    expect(target.closest('[data-id]')?.getAttribute('data-id')).toBe('b3')
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' })
    expect(animate).toHaveBeenCalled()
    expect(animate.mock.calls[0][0][0]).toMatchObject({ backgroundColor: 'rgb(1, 2, 3)' })
    document.documentElement.style.removeProperty('--color-blue-100')
  })

  it('本文が後から届いても（同時編集の議事録）、届いた時点で動く', async () => {
    window.history.replaceState(null, '', `/org/project/space/wiki?page=p-1#${encodeURIComponent('まとめ')}`)
    const editor = makeEditor([])
    const { rerender } = render(<Harness editor={editor} blocks={[]} />)
    await new Promise((r) => setTimeout(r, 150))
    expect(scrollIntoView).not.toHaveBeenCalled()
    rerender(<Harness editor={editor} blocks={BLOCKS} />)
    act(() => editor.emit(DOC))
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1))
  })

  it('ブロックID の # でも動く（前からあるリンク）', async () => {
    window.history.replaceState(null, '', '/org/project/space/wiki?page=p-1#b2')
    render(<Harness editor={makeEditor(DOC)} blocks={BLOCKS} />)
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1))
    expect((scrollIntoView.mock.instances[0] as Element).closest('[data-id]')?.getAttribute('data-id')).toBe('b2')
  })

  it('同じページのまま # が変わっても動く', async () => {
    render(<Harness editor={makeEditor(DOC)} blocks={BLOCKS} />)
    expect(scrollIntoView).not.toHaveBeenCalled()
    window.history.replaceState(null, '', `/org/project/space/wiki?page=p-1#${encodeURIComponent('1-振り分けの結果')}`)
    act(() => {
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1))
    expect((scrollIntoView.mock.instances[0] as Element).closest('[data-id]')?.getAttribute('data-id')).toBe('b1')
  })

  it('見つからなければ何もしない', async () => {
    vi.useFakeTimers()
    window.history.replaceState(null, '', '/org/project/space/wiki?page=p-1#無い見出し')
    render(<Harness editor={makeEditor(DOC)} blocks={BLOCKS} />)
    await act(async () => {
      vi.advanceTimersByTime(10_000)
    })
    expect(scrollIntoView).not.toHaveBeenCalled()
  })
})

describe('HeadingLinks — 打つたびに描き直さない', () => {
  it('見出し以外が変わっただけなら、ボタンを作り直さない', () => {
    const editor = makeEditor(DOC)
    render(<Harness editor={editor} blocks={BLOCKS} />)
    const before = screen.getAllByRole('button', { name: '見出しへのリンクをコピー' })
    act(() => editor.emit([...DOC, { id: 'p9', type: 'paragraph', props: {}, content: [{ type: 'text', text: '追記', styles: {} }], children: [] }]))
    const after = screen.getAllByRole('button', { name: '見出しへのリンクをコピー' })
    after.forEach((b, i) => expect(b).toBe(before[i]))
  })
})
