import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { useInAppLinkNavigation } from '@/components/editor/inAppLinkNavigation'

/**
 * 本文中のリンクで画面を移る前に、待ち時間中の自動保存を確定させる。
 * 保存しきれなかったときは移動しない（書きかけを消さない）。
 */

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))

/** エディタの外枠の中にリンクを1本置いた画面を作り、そのリンクを押す */
function renderWithLink(href: string, onBeforeNavigate?: () => void | Promise<void>, enabled = true) {
  let anchor: HTMLAnchorElement | null = null
  function Harness() {
    const ref = useInAppLinkNavigation(onBeforeNavigate, enabled)
    return React.createElement(
      'div',
      { ref },
      React.createElement('a', { href, ref: (n: HTMLAnchorElement | null) => { anchor = n } }, 'リンク')
    )
  }
  render(React.createElement(Harness))
  return {
    click: async () => {
      await act(async () => {
        anchor!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
      })
    },
    wasDefaultPrevented: () => {
      const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
      anchor!.dispatchEvent(event)
      return event.defaultPrevented
    },
  }
}

const HREF = '/org-1/project/space-1?task=t1'

beforeEach(() => {
  push.mockClear()
})

describe('useInAppLinkNavigation', () => {
  it('保存を確定させてから同じタブで移る', async () => {
    const flush = vi.fn(async () => {})
    const link = renderWithLink(HREF, flush)

    await link.click()

    expect(flush).toHaveBeenCalled()
    expect(push).toHaveBeenCalledWith(HREF)
  })

  it('保存しきれなかったときは移らない', async () => {
    const flush = vi.fn(async () => {
      throw new Error('別の場所で更新されています')
    })
    const link = renderWithLink(HREF, flush)

    await link.click()

    expect(push).not.toHaveBeenCalled()
  })

  it('保存する処理が渡されていなくても移れる', async () => {
    const link = renderWithLink(HREF)
    await link.click()
    expect(push).toHaveBeenCalledWith(HREF)
  })

  it('ブラウザの既定の動き（別タブを開く）を止める', () => {
    const link = renderWithLink(HREF)
    expect(link.wasDefaultPrevented()).toBe(true)
  })

  it('ファイルのダウンロードには手を出さない', async () => {
    const link = renderWithLink('/api/files/f1/download')
    expect(link.wasDefaultPrevented()).toBe(false)
    expect(push).not.toHaveBeenCalled()
  })

  it('相手先ポータルなど、使わない画面では何もしない', async () => {
    const link = renderWithLink(HREF, undefined, false)
    expect(link.wasDefaultPrevented()).toBe(false)
    expect(push).not.toHaveBeenCalled()
  })
})
