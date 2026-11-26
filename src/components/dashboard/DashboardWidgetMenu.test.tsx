import { describe, it, expect, beforeEach } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { DashboardWidgetMenu } from './DashboardWidgetMenu'
import { DASHBOARD_WIDGETS, useDashboardWidgetPrefs } from '@/lib/dashboard/widgetPrefs'

/** 実際のフック（localStorage に保存）をつないだメニュー */
function Harness() {
  const widgets = useDashboardWidgetPrefs()
  return <DashboardWidgetMenu {...widgets} />
}

function openMenu() {
  render(<Harness />)
  fireEvent.click(screen.getByTestId('dashboard-widgets-toggle'))
  return screen.getByRole('menu', { name: '表示する項目' })
}

/** 行の並び（チェックの付け外しの項目名を、上から） */
function rowLabels(menu: HTMLElement): string[] {
  return within(menu)
    .getAllByRole('menuitemcheckbox')
    .map((el) => el.textContent ?? '')
}

const label = (id: string) => DASHBOARD_WIDGETS.find((w) => w.id === id)!.label

beforeEach(() => {
  localStorage.clear()
})

describe('DashboardWidgetMenu — 並び替え', () => {
  it('はじめは既定の順で、「最近のアクティビティ」は「最近のコメント」の下', () => {
    const labels = rowLabels(openMenu())
    expect(labels).toEqual(DASHBOARD_WIDGETS.map((w) => w.label))
    expect(labels.indexOf(label('activity'))).toBe(labels.indexOf(label('recent_comments')) + 1)
  })

  it('「ボール（件数のまとめ）」は「件数のまとめ」の直後で、上へ・下へのボタンが無い', () => {
    const menu = openMenu()
    const labels = rowLabels(menu)
    expect(labels[labels.indexOf(label('kpi')) + 1]).toBe(label('kpi_ball'))
    expect(within(menu).queryByRole('menuitem', { name: `${label('kpi_ball')}を上へ` })).not.toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: `${label('kpi_ball')}を下へ` })).not.toBeInTheDocument()
  })

  it('「下へ」を押すと、その項目が1つ下がる', () => {
    const menu = openMenu()
    fireEvent.click(within(menu).getByRole('menuitem', { name: `${label('overdue')}を下へ` }))
    const labels = rowLabels(menu)
    expect(labels.indexOf(label('decisions'))).toBeLessThan(labels.indexOf(label('overdue')))
    expect(labels.indexOf(label('overdue'))).toBe(labels.indexOf(label('decisions')) + 1)
  })

  it('「上へ」を押すと、その項目が1つ上がる', () => {
    const menu = openMenu()
    fireEvent.click(within(menu).getByRole('menuitem', { name: `${label('decisions')}を上へ` }))
    const labels = rowLabels(menu)
    expect(labels.indexOf(label('decisions'))).toBeLessThan(labels.indexOf(label('overdue')))
  })

  it('先頭は「上へ」、末尾は「下へ」が押せない', () => {
    const menu = openMenu()
    expect(within(menu).getByRole('menuitem', { name: `${label('kpi')}を上へ` })).toBeDisabled()
    expect(within(menu).getByRole('menuitem', { name: `${label('kpi')}を下へ` })).toBeEnabled()
    expect(within(menu).getByRole('menuitem', { name: `${label('meetings')}を下へ` })).toBeDisabled()
    expect(within(menu).getByRole('menuitem', { name: `${label('meetings')}を上へ` })).toBeEnabled()
  })

  it('並べ替えても、チェックの状態は変わらない', () => {
    const menu = openMenu()
    fireEvent.click(within(menu).getByRole('menuitemcheckbox', { name: label('overdue') }))
    fireEvent.click(within(menu).getByRole('menuitem', { name: `${label('overdue')}を下へ` }))
    expect(within(menu).getByRole('menuitemcheckbox', { name: label('overdue') })).toHaveAttribute(
      'aria-checked',
      'false'
    )
  })

  it('「並び順を元に戻す」で既定の順に戻る', () => {
    const menu = openMenu()
    fireEvent.click(within(menu).getByRole('menuitem', { name: `${label('overdue')}を下へ` }))
    expect(rowLabels(menu)).not.toEqual(DASHBOARD_WIDGETS.map((w) => w.label))
    fireEvent.click(within(menu).getByRole('menuitem', { name: '並び順を元に戻す' }))
    expect(rowLabels(menu)).toEqual(DASHBOARD_WIDGETS.map((w) => w.label))
  })
})
