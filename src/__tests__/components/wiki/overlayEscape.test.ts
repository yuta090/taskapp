import { describe, it, expect, afterEach } from 'vitest'
import { shouldCloseOverlayOnEscape } from '@/components/wiki/overlayEscape'

/**
 * 重ねた Wiki を Esc で閉じてよいか。エディタのメニューを閉じる Esc を奪わない。
 * BlockNote の「/」メニューは floating-ui が document で Esc を聞くが preventDefault しないので、
 * 「止められていたら閉じない」だけでは見分けられない（レビュー指摘・実物で確認）。
 */

afterEach(() => {
  document.body.innerHTML = ''
})

function esc(target: Element, over: Partial<KeyboardEventInit> = {}, prevented = false) {
  const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, ...over })
  Object.defineProperty(e, 'target', { value: target })
  if (prevented) e.preventDefault()
  return e
}

describe('shouldCloseOverlayOnEscape', () => {
  it('何も開いていなければ閉じる', () => {
    expect(shouldCloseOverlayOnEscape(esc(document.body))).toBe(true)
  })

  it('エディタで書いている途中でも、1回で閉じる（BlockNote が外すために止めていても）', () => {
    document.body.innerHTML = '<div class="bn-editor" contenteditable="true"><p id="p">本文</p></div>'
    expect(shouldCloseOverlayOnEscape(esc(document.getElementById('p')!, {}, true))).toBe(true)
  })

  it.each(['bn-suggestion-menu', 'bn-grid-suggestion-menu', 'bn-menu-dropdown', 'bn-toolbar'])(
    'エディタのメニュー（%s）が出ていれば閉じない',
    (cls) => {
      document.body.innerHTML = `<div class="${cls}"></div>`
      expect(shouldCloseOverlayOnEscape(esc(document.body))).toBe(false)
    }
  )

  it('日本語の変換を確定する Esc では閉じない', () => {
    expect(shouldCloseOverlayOnEscape(esc(document.body, { isComposing: true }))).toBe(false)
  })

  it('エディタの外の入力欄（リンクの検索など）で止められた Esc では閉じない', () => {
    document.body.innerHTML = '<input id="q" />'
    expect(shouldCloseOverlayOnEscape(esc(document.getElementById('q')!, {}, true))).toBe(false)
  })

  it('Esc 以外のキーでは閉じない', () => {
    expect(shouldCloseOverlayOnEscape(esc(document.body, { key: 'Enter' }))).toBe(false)
  })
})
