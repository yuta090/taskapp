import { describe, it, expect, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { clampPanelPosition, usePanelPosition } from './usePanelPosition'

const viewport = { width: 1440, height: 900 }

describe('clampPanelPosition', () => {
  it('places the panel below the target when there is room', () => {
    const targetRect = { top: 100, bottom: 140, left: 200, width: 100 }
    const { top, left } = clampPanelPosition(targetRect, { width: 320, height: 200 }, viewport)

    expect(top).toBe(156) // targetRect.bottom + margin(16)
    expect(left).toBe(90) // centered under target: 200 + 100/2 - 320/2
  })

  it('flips above the target when there is not enough room below', () => {
    const targetRect = { top: 750, bottom: 800, left: 200, width: 100 }
    const { top } = clampPanelPosition(targetRect, { width: 320, height: 200 }, viewport)

    expect(top).toBe(534) // targetRect.top - panelHeight(200) - margin(16)
  })

  it('clamps the top so the panel never renders above the viewport', () => {
    // Target near the very top with a panel taller than the space above it.
    const targetRect = { top: 20, bottom: 60, left: 200, width: 100 }
    const { top } = clampPanelPosition(targetRect, { width: 320, height: 900 }, viewport)

    expect(top).toBeGreaterThanOrEqual(16)
  })

  it('clamps the top so the panel never renders below the viewport', () => {
    // Target flush against the bottom with a panel taller than remaining space.
    const targetRect = { top: 860, bottom: 895, left: 200, width: 100 }
    const { top } = clampPanelPosition(targetRect, { width: 320, height: 400 }, viewport)

    expect(top + 400).toBeLessThanOrEqual(viewport.height)
    expect(top).toBeGreaterThanOrEqual(0)
  })

  it('clamps the left edge so the panel never renders off the left of the viewport', () => {
    const targetRect = { top: 100, bottom: 140, left: 0, width: 20 }
    const { left } = clampPanelPosition(targetRect, { width: 320, height: 200 }, viewport)

    expect(left).toBeGreaterThanOrEqual(16)
  })

  it('clamps the right edge so the panel never renders off the right of the viewport', () => {
    const targetRect = { top: 100, bottom: 140, left: 1400, width: 30 }
    const { left } = clampPanelPosition(targetRect, { width: 320, height: 200 }, viewport)

    expect(left + 320).toBeLessThanOrEqual(viewport.width)
  })

  it('keeps the whole panel on-screen for a target pinned to the bottom-right corner', () => {
    const smallViewport = { width: 500, height: 400 }
    const targetRect = { top: 370, bottom: 395, left: 460, width: 35 }
    const panelSize = { width: 320, height: 260 }

    const { top, left } = clampPanelPosition(targetRect, panelSize, smallViewport)

    expect(top).toBeGreaterThanOrEqual(0)
    expect(left).toBeGreaterThanOrEqual(0)
    expect(top + panelSize.height).toBeLessThanOrEqual(smallViewport.height)
    expect(left + panelSize.width).toBeLessThanOrEqual(smallViewport.width)
  })

  it('390px幅のスマホ画面でも、パネルが右端からはみ出さない', () => {
    // 本番計測(390x844)の再現: パネル幅は `w-[calc(100vw-2rem)]` により
    // ビューポート幅から左右マージン(16px×2)を引いた358pxになる。
    const phoneViewport = { width: 390, height: 844 }
    const targetRect = { top: 1227, bottom: 1267, left: 16, width: 358 }
    const panelSize = { width: 358, height: 260 }

    const { top, left } = clampPanelPosition(targetRect, panelSize, phoneViewport)

    expect(left).toBeGreaterThanOrEqual(0)
    expect(left + panelSize.width).toBeLessThanOrEqual(phoneViewport.width)
    expect(top).toBeGreaterThanOrEqual(0)
    expect(top + panelSize.height).toBeLessThanOrEqual(phoneViewport.height)
  })

  it('対象が縦長で上下どちらにも収まらない場合、パネルは画面下部に固定し対象の先頭を隠さない', () => {
    // 本番計測: step1はアクションセクション全体(高さ673px)をスポットライトする。
    // 上(109px)にも下(62px)にもパネル(253px)が収まらないケース。
    const phoneViewport = { width: 390, height: 844 }
    const targetRect = { top: 109, bottom: 782, left: 16, width: 358 }
    const panelSize = { width: 358, height: 253 }

    const { top } = clampPanelPosition(targetRect, panelSize, phoneViewport)

    // 対象の先頭（見出しや先頭カード）が隠れないよう、パネルは対象より下に来る
    expect(top).toBeGreaterThan(targetRect.top)
    expect(top + panelSize.height).toBeLessThanOrEqual(phoneViewport.height)
  })

  it('下に収まる場合は挙動が変わらない（回帰確認）', () => {
    const targetRect = { top: 100, bottom: 140, left: 200, width: 100 }
    const { top } = clampPanelPosition(targetRect, { width: 320, height: 200 }, viewport)

    expect(top).toBe(156)
  })

  it('下に収まらず上には収まる場合は上に表示する（回帰確認）', () => {
    const targetRect = { top: 750, bottom: 800, left: 200, width: 100 }
    const { top } = clampPanelPosition(targetRect, { width: 320, height: 200 }, viewport)

    expect(top).toBe(534)
  })

  it('低い横画面(スマホ横向き等)で下端固定にすると対象を覆ってしまう場合は、代わりに画面上端に固定する', () => {
    // 高さ320pxの短いビューポートで、小さな対象(40px)が画面中央付近(250-290)にある
    // ケース。パネル(253px)は上にも下にも収まらない。下端固定(top=51)だと
    // 対象(250-290)がパネル(51-304)にすっぽり覆われてしまうため、上端固定にする。
    const shortViewport = { width: 390, height: 320 }
    const targetRect = { top: 250, bottom: 290, left: 16, width: 358 }
    const panelSize = { width: 358, height: 253 }

    const { top } = clampPanelPosition(targetRect, panelSize, shortViewport)

    expect(top).toBe(16)
  })

  it('対象が縦長で上下どちらにも収まらない場合は、これまで通り画面下部に固定する（回帰確認）', () => {
    const phoneViewport = { width: 390, height: 844 }
    const targetRect = { top: 109, bottom: 782, left: 16, width: 358 }
    const panelSize = { width: 358, height: 253 }

    const { top } = clampPanelPosition(targetRect, panelSize, phoneViewport)

    expect(top).toBeGreaterThan(targetRect.top)
    expect(top + panelSize.height).toBeLessThanOrEqual(phoneViewport.height)
  })
})

describe('usePanelPosition — 実寸(offsetWidth/offsetHeight)での計測', () => {
  const originalInnerWidth = window.innerWidth
  const originalInnerHeight = window.innerHeight

  afterEach(() => {
    window.innerWidth = originalInnerWidth
    window.innerHeight = originalInnerHeight
    document.body.innerHTML = ''
  })

  it('フェードイン中の transform(scale-95) で縮んだ getBoundingClientRect ではなく、offsetWidth/offsetHeight を使って計測する', () => {
    // 390x844のスマホ画面で、パネルの実寸(CSS幅)は358pxだが、
    // フェードイン中の scale-95 transform により getBoundingClientRect() は
    // 340x240相当の縮小サイズを返す状況を再現する。
    window.innerWidth = 390
    window.innerHeight = 844

    const panelEl = document.createElement('div')
    Object.defineProperty(panelEl, 'offsetWidth', { value: 358, configurable: true })
    Object.defineProperty(panelEl, 'offsetHeight', { value: 253, configurable: true })
    panelEl.getBoundingClientRect = () =>
      ({
        top: 0,
        left: 0,
        right: 340,
        bottom: 240,
        width: 340,
        height: 240,
        x: 0,
        y: 0,
        toJSON() {},
      }) as DOMRect
    document.body.appendChild(panelEl)

    const panelRef = { current: panelEl }
    const targetRect = {
      top: 100,
      bottom: 140,
      left: 16,
      right: 374,
      width: 358,
      height: 40,
      x: 16,
      y: 100,
      toJSON() {},
    } as DOMRect

    const { result } = renderHook(() => usePanelPosition(panelRef, targetRect))

    expect(result.current).toBeDefined()
    const left = Number(result.current?.left)
    // offsetWidth(358)で計測できていれば右端をはみ出さない。
    // getBoundingClientRect の縮小幅(340)を使ってしまうと画面外にはみ出す。
    expect(left + 358).toBeLessThanOrEqual(390 - 16)
  })
})
