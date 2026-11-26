import { describe, it, expect, vi } from 'vitest'
import { createEvent, fireEvent, render, screen } from '@testing-library/react'
import { DashboardWidgetFrame } from './DashboardWidgetFrame'

function setup(overrides: Partial<React.ComponentProps<typeof DashboardWidgetFrame>> = {}) {
  const handlers = {
    onDragStart: vi.fn(),
    onDragEnd: vi.fn(),
    onDragOverWidget: vi.fn(),
    onDragLeaveWidget: vi.fn(),
    onDropOnWidget: vi.fn(),
  }
  render(
    <DashboardWidgetFrame id="overdue" label="期限切れ" draggingId={null} overId={null} {...handlers} {...overrides}>
      <p>中身</p>
    </DashboardWidgetFrame>
  )
  return handlers
}

describe('DashboardWidgetFrame', () => {
  it('項目を包み、data-testid を付ける', () => {
    setup()
    expect(screen.getByTestId('dashboard-widget-overdue')).toHaveTextContent('中身')
  })

  it('つかみはデスクトップ（md 以上）だけに出る。スマホでは hidden', () => {
    setup()
    const handle = screen.getByTestId('dashboard-widget-handle-overdue')
    expect(handle).toHaveAttribute('draggable', 'true')
    expect(handle.className).toMatch(/\bhidden\b/)
    expect(handle.className).toMatch(/\bmd:flex\b/)
  })

  it('つかみのドラッグを始めると、その項目の id を知らせる。終わると知らせる', () => {
    const h = setup()
    const handle = screen.getByTestId('dashboard-widget-handle-overdue')
    fireEvent.dragStart(handle)
    expect(h.onDragStart).toHaveBeenCalledWith('overdue')
    fireEvent.dragEnd(handle)
    expect(h.onDragEnd).toHaveBeenCalled()
  })

  it('ほかの項目をドラッグ中は、上に重なると落とせる（dragover を受ける）', () => {
    const h = setup({ draggingId: 'meetings' })
    const frame = screen.getByTestId('dashboard-widget-overdue')
    const event = createEvent.dragOver(frame)
    fireEvent(frame, event)
    expect(event.defaultPrevented).toBe(true)
    expect(h.onDragOverWidget).toHaveBeenCalledWith('overdue')
  })

  it('自分自身の上や、ドラッグ中でないときは落とせない', () => {
    const h = setup({ draggingId: 'overdue' })
    const frame = screen.getByTestId('dashboard-widget-overdue')
    const event = createEvent.dragOver(frame)
    fireEvent(frame, event)
    expect(event.defaultPrevented).toBe(false)
    expect(h.onDragOverWidget).not.toHaveBeenCalled()
  })

  it('落とすと、落とし先の id を知らせる', () => {
    const h = setup({ draggingId: 'meetings' })
    fireEvent.drop(screen.getByTestId('dashboard-widget-overdue'))
    expect(h.onDropOnWidget).toHaveBeenCalledWith('overdue')
  })

  it('ドラッグ中の項目は、見た目で分かる', () => {
    setup({ draggingId: 'overdue' })
    expect(screen.getByTestId('dashboard-widget-overdue')).toHaveAttribute('data-dragging', 'true')
    expect(screen.getByTestId('dashboard-widget-overdue')).not.toHaveAttribute('data-drop-target')
  })

  it('落とし先になっている項目は、見た目で分かる', () => {
    setup({ draggingId: 'meetings', overId: 'overdue' })
    expect(screen.getByTestId('dashboard-widget-overdue')).toHaveAttribute('data-drop-target', 'true')
    expect(screen.getByTestId('dashboard-widget-overdue')).not.toHaveAttribute('data-dragging')
  })
})
