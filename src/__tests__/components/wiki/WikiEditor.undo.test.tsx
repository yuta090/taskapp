// @vitest-environment jsdom
/**
 * Wiki のエディタで Ctrl+Z / Cmd+Z（取り消し）が効くかを、本物の BlockNote で確かめる。
 *
 * 気をつける点は議事録と同じ。**「書いてよいか」を途中で変えると、BlockNote は
 * エディタを丸ごと作り直す**。Wiki では、自分の役割（書ける人かどうか）が決まるのが
 * 本文より遅いことがあり、そのとき「書けない → 書ける」が1回起きる。
 *
 * いまの Wiki は1人用の取り消しなので、作り直されても控えは残る（実測）。
 * それでも作り直させないのは、カーソルの位置と見ていた場所が失われる無駄であり、
 * **同時編集をつないだ日に取り消しが死ぬ**ため（議事録で実際に起きた）。
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { WikiEditor } from '@/components/wiki/WikiEditor'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

// BlockNote の見た目は Mantine 経由で色の設定を読む。jsdom には無いので足す
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia
}

const BODY = JSON.stringify([
  { type: 'paragraph', content: [{ type: 'text', text: 'もとの行', styles: {} }] },
])

const opened: { unmount: () => void }[] = []

function open(editable: boolean) {
  const props = (next: boolean) => ({
    initialContent: BODY,
    orgId: 'org-1',
    spaceId: 'space-1',
    currentPageId: 'page-1',
    editable: next,
  })
  const view = render(<WikiEditor {...props(editable)} />)
  opened.push(view)
  return {
    view,
    rerenderWith: (next: boolean) => view.rerender(<WikiEditor {...props(next)} />),
    body: () => view.container.querySelector('[contenteditable]') as HTMLElement,
  }
}

/** キーボードで打つのと同じ経路（ProseMirror の取引）で1語足す */
function type(body: HTMLElement, text: string) {
  const tiptap = (body as HTMLElement & { editor?: { commands: { insertContent: (t: string) => void } } }).editor
  tiptap?.commands.insertContent(text)
}

/** いま載っている ProseMirror の本体。作り直されると別のものになる */
function editorViewOf(body: HTMLElement): unknown {
  return (body as HTMLElement & { editor?: { view: unknown } }).editor?.view
}

function pressUndo(body: HTMLElement) {
  body.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true })
  )
}

afterEach(() => {
  while (opened.length) opened.pop()?.unmount()
})

describe('Wiki のエディタの取り消し（Ctrl+Z / Cmd+Z）', () => {
  it('書ける状態のまま載せれば、Ctrl+Z で打つ前に戻る', async () => {
    const screen = open(true)
    await act(async () => {
      type(screen.body(), 'あとから打った文字')
    })
    expect(screen.body().textContent).toContain('あとから打った文字')

    await act(async () => {
      pressUndo(screen.body())
    })

    expect(screen.body().textContent).not.toContain('あとから打った文字')
    expect(screen.body().textContent).toContain('もとの行')
  })

  /**
   * 本番でいちばん起きる形。自分の役割は所属の一覧を読み終えてから決まるので、
   * 手元に控えが無いとき（初回・別の端末・ログアウト直後・再読み込み）は
   * 本文のほうが先に出て、あとから「書ける」に変わる。
   */
  it('あとから書ける状態に変わっても、Ctrl+Z は効き続ける', async () => {
    const screen = open(false)
    const before = editorViewOf(screen.body())
    expect(before).toBeDefined()
    await act(async () => {
      screen.rerenderWith(true)
    })
    // 変わってもエディタを作り直さない（作り直すと、同時編集をつないだ日に取り消しが死ぬ）
    expect(editorViewOf(screen.body())).toBe(before)
    await act(async () => {
      type(screen.body(), 'あとから打った文字')
    })
    expect(screen.body().textContent).toContain('あとから打った文字')

    await act(async () => {
      pressUndo(screen.body())
    })

    expect(screen.body().textContent).not.toContain('あとから打った文字')
    expect(screen.body().textContent).toContain('もとの行')
  })

  it('読み取り専用に変えたら、その場で書けなくなる', async () => {
    const screen = open(true)
    expect(screen.body().getAttribute('contenteditable')).toBe('true')

    await act(async () => {
      screen.rerenderWith(false)
    })

    expect(screen.body().getAttribute('contenteditable')).toBe('false')
    // 読めるだけの本文にも、キーボードだけで入れること
    expect(screen.body().getAttribute('tabindex')).toBe('0')
  })
})
