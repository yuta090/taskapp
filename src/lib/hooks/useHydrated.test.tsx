import React, { act } from 'react'
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import { useHydrated } from './useHydrated'

// hydrateRoot を act() 経由で呼ぶための実行環境フラグ（RTL 経由の描画ではなく
// react-dom/client を直接使うテストなので、自前で立てる必要がある）
beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

function Probe() {
  const hydrated = useHydrated()
  return <div data-testid="probe">{hydrated ? 'hydrated' : 'pending'}</div>
}

describe('useHydrated — サーバーの描画とブラウザの最初の描画を一致させる', () => {
  it('ハイドレーション時の描画は必ず「pending」（サーバーと同じ）で、完了直後の1回だけ「hydrated」に切り替わる', async () => {
    const html = renderToString(<Probe />)
    expect(html).toContain('pending')

    const container = document.createElement('div')
    container.innerHTML = html
    document.body.appendChild(container)

    // ハイドレーション時の描画がサーバーと一致していれば、React はこの警告を出さない
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    let root: ReturnType<typeof hydrateRoot>
    await act(async () => {
      root = hydrateRoot(container, <Probe />)
    })

    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()

    // ハイドレーション完了直後には、実際のブラウザ値（true）へ切り替わっている
    expect(container.textContent).toBe('hydrated')

    act(() => root.unmount())
    container.remove()
  })
})
