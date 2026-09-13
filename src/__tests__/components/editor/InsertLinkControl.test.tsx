import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { InsertLinkControl } from '@/components/editor/InsertLinkControl'

/**
 * 開いたパネルを閉じられること。
 * ボタンをもう一度押す以外に、Esc と「パネルの外を押す」でも閉じられるようにする。
 */

vi.mock('@/components/editor/AppLinkPicker', () => ({
  AppLinkPicker: ({ defaultKind }: { defaultKind?: string }) => (
    <div data-testid="app-link-picker" data-kind={defaultKind}>
      <button type="button" data-testid="inside-button">
        中のボタン
      </button>
    </div>
  ),
}))

const onToggle = vi.fn()
const onClose = vi.fn()
const onSelect = vi.fn()

function renderControl(openKind: 'file' | 'task' | 'wiki' | 'meeting' | null) {
  return render(
    <div>
      <button type="button" data-testid="outside-button">
        外のボタン
      </button>
      <InsertLinkControl
        orgId="org-1"
        spaceId="space-1"
        openKind={openKind}
        onToggle={onToggle}
        onClose={onClose}
        onSelect={onSelect}
      />
    </div>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('InsertLinkControl — 開け閉め', () => {
  it('閉じているときはパネルを出さない', () => {
    renderControl(null)
    expect(screen.queryByTestId('app-link-picker')).not.toBeInTheDocument()
  })

  it('開くときは、指定された種類でピッカーを出す', async () => {
    renderControl('task')
    const picker = await screen.findByTestId('app-link-picker')
    expect(picker).toHaveAttribute('data-kind', 'task')
  })

  it('Esc を押すと閉じる', async () => {
    renderControl('file')
    await screen.findByTestId('app-link-picker')

    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })
    expect(onClose).toHaveBeenCalled()
  })

  it('パネルの外を押すと閉じる', async () => {
    renderControl('file')
    await screen.findByTestId('app-link-picker')

    fireEvent.mouseDown(screen.getByTestId('outside-button'))
    expect(onClose).toHaveBeenCalled()
  })

  it('パネルの中を押しても閉じない', async () => {
    renderControl('file')
    await screen.findByTestId('app-link-picker')

    fireEvent.mouseDown(screen.getByTestId('inside-button'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('ボタン自体を押したときは、開け閉めの担当（onToggle）に任せて二重に閉じない', async () => {
    renderControl('file')
    await screen.findByTestId('app-link-picker')

    fireEvent.mouseDown(screen.getByTestId('editor-insert-link'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('閉じているときは Esc も外側の操作も拾わない', () => {
    renderControl(null)
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.mouseDown(screen.getByTestId('outside-button'))
    expect(onClose).not.toHaveBeenCalled()
  })
})
