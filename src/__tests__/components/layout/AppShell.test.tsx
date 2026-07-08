import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AppShell, useInspector } from '@/components/layout'

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
})
