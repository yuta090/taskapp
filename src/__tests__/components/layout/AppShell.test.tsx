import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AppShell, useInspector, useShellFullscreen } from '@/components/layout'

// Heavy children mocked to keep the shell contract in focus
vi.mock('@/components/layout/LeftNav', () => ({
  LeftNav: () => <nav data-testid="left-nav">nav</nav>,
}))
vi.mock('@/components/announcement/AnnouncementBell', () => ({
  AnnouncementBell: () => <div data-testid="bell" />,
}))
vi.mock('@/components/shared/KeyboardShortcutsHelp', () => ({
  useShortcutsHelp: () => ({ ShortcutsHelp: null }),
}))
vi.mock('@/components/shared/CommandPalette', () => ({
  useCommandPalette: () => ({ CommandPalette: null }),
}))

/** Test consumer that pushes a node into the inspector via context */
function InspectorTrigger() {
  const { setInspector } = useInspector()
  return (
    <button type="button" onClick={() => setInspector(<div>INSPECTOR_CONTENT</div>)}>
      open-inspector
    </button>
  )
}

/** Test consumer that pushes a node into the inspector with the narrow size option */
function NarrowInspectorTrigger() {
  const { setInspector } = useInspector()
  return (
    <button
      type="button"
      onClick={() => setInspector(<div>NARROW_CONTENT</div>, { size: 'narrow' })}
    >
      open-narrow-inspector
    </button>
  )
}

/** Test consumer that turns the shell's full-screen mode on/off (Wiki の「全画面」が使う) */
function FullscreenTrigger() {
  const { fullscreen, setFullscreen } = useShellFullscreen()
  return (
    <button type="button" onClick={() => setFullscreen(!fullscreen)}>
      toggle-fullscreen
    </button>
  )
}

function renderShell() {
  return render(
    <AppShell>
      <InspectorTrigger />
    </AppShell>
  )
}

describe('AppShell — モバイルシェル (PR1)', () => {
  it('単一のmainとInspectorペインを描画する', () => {
    const { container } = renderShell()
    expect(container.querySelectorAll('#main-content')).toHaveLength(1)
    expect(container.querySelectorAll('.inspector-pane')).toHaveLength(1)
  })

  it('Inspector未設定時はopenクラスを持たない', () => {
    const { container } = renderShell()
    const pane = container.querySelector('.inspector-pane')!
    expect(pane.classList.contains('open')).toBe(false)
  })

  it('setInspectorで単一ペインがopenになり内容を表示（二重マウントしない）', () => {
    const { container } = renderShell()
    fireEvent.click(screen.getByText('open-inspector'))

    const panes = container.querySelectorAll('.inspector-pane')
    expect(panes).toHaveLength(1)
    expect(panes[0].classList.contains('open')).toBe(true)
    // 単一インスタンス契約: 内容が同時に2つ描画されない
    expect(screen.getAllByText('INSPECTOR_CONTENT')).toHaveLength(1)
  })

  it('モバイルヘッダのハンバーガーでナビゲーションドロワーを開閉できる', () => {
    const { container } = renderShell()

    // 初期はドロワー非表示
    expect(
      screen.queryByRole('dialog', { name: 'ナビゲーションメニュー' })
    ).not.toBeInTheDocument()

    // ハンバーガーで開く
    fireEvent.click(screen.getByLabelText('メニューを開く'))
    expect(
      screen.getByRole('dialog', { name: 'ナビゲーションメニュー' })
    ).toBeInTheDocument()
    // ドロワーを開いてもInspectorは単一のまま
    expect(container.querySelectorAll('.inspector-pane')).toHaveLength(1)

    // 閉じるボタンで閉じる
    fireEvent.click(screen.getByLabelText('メニューを閉じる'))
    expect(
      screen.queryByRole('dialog', { name: 'ナビゲーションメニュー' })
    ).not.toBeInTheDocument()
  })

  it('Escキーでナビゲーションドロワーを閉じる', () => {
    renderShell()
    fireEvent.click(screen.getByLabelText('メニューを開く'))
    expect(
      screen.getByRole('dialog', { name: 'ナビゲーションメニュー' })
    ).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(
      screen.queryByRole('dialog', { name: 'ナビゲーションメニュー' })
    ).not.toBeInTheDocument()
  })

  /**
   * ガントの画面で、本体(main)が画面の幅を 400px はみ出していた。
   * 中央エリアが flex-1 だけで min-width の下限を外していなかったため、
   * 中身の最小幅までふくらんでしまうのが原因。はみ出した右端は
   * 画面の外に切り落とされ、ヘッダー右端のお知らせベル・案内文・
   * ビュー切替タブが押せなくなっていた。
   *
   * jsdom は幅を計算しないので、ここでは「下限を外す指定が付いていること」を守る。
   * 実際の幅は本番プレビューで測って確認する。
   */
  it('中央エリアは中身の最小幅で広がらない（min-w-0）', () => {
    const { container } = renderShell()
    const center = container.querySelector('#main-content')!.closest('.justify-center')!
    expect(center.className).toContain('min-w-0')
  })

  it('setInspector(node)（既定）はinspector-narrowを持たない', () => {
    const { container } = renderShell()
    fireEvent.click(screen.getByText('open-inspector'))
    const pane = container.querySelector('.inspector-pane')!
    expect(pane.classList.contains('inspector-narrow')).toBe(false)
  })

  it('setInspector(node, { size: "narrow" })でinspector-narrowが付く', () => {
    const { container } = render(
      <AppShell>
        <NarrowInspectorTrigger />
      </AppShell>
    )
    fireEvent.click(screen.getByText('open-narrow-inspector'))
    const pane = container.querySelector('.inspector-pane')!
    expect(pane.classList.contains('open')).toBe(true)
    expect(pane.classList.contains('inspector-narrow')).toBe(true)
  })

  // 全画面は重ね表示にしない（main の z-0 の中からは LeftNav の上に出られず、本文の左端が隠れた）。
  // 代わりに枠がデスクトップの LeftNav を外し、本文を画面いっぱいに広げる
  it('全画面にするとデスクトップの LeftNav を隠し、戻すと出す（Wiki の「全画面」）', () => {
    render(
      <AppShell>
        <FullscreenTrigger />
      </AppShell>
    )
    expect(screen.getByTestId('left-nav').parentElement!.className).toContain('md:flex')

    fireEvent.click(screen.getByText('toggle-fullscreen'))
    expect(screen.getByTestId('left-nav').parentElement!.className).not.toContain('md:flex')

    fireEvent.click(screen.getByText('toggle-fullscreen'))
    expect(screen.getByTestId('left-nav').parentElement!.className).toContain('md:flex')
  })
})
