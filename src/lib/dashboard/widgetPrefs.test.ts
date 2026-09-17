import { describe, it, expect, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  DASHBOARD_WIDGETS,
  DASHBOARD_WIDGET_PREFS_KEY,
  parseDashboardWidgetPrefs,
  useDashboardWidgetPrefs,
} from './widgetPrefs'

describe('parseDashboardWidgetPrefs — 保存した表示設定を読む', () => {
  it('何も保存していなければ、全部の項目を出す', () => {
    expect(parseDashboardWidgetPrefs(null)).toEqual({ hidden: [] })
  })

  it('隠した項目の一覧を読む', () => {
    expect(parseDashboardWidgetPrefs(JSON.stringify({ hidden: ['ball', 'meetings'] }))).toEqual({
      hidden: ['ball', 'meetings'],
    })
  })

  it('知らない項目名は捨てる（項目を減らしたあとの古い保存値）', () => {
    expect(parseDashboardWidgetPrefs(JSON.stringify({ hidden: ['ball', 'removed_widget', 3] }))).toEqual({
      hidden: ['ball'],
    })
  })

  it('壊れた値なら、全部出す', () => {
    expect(parseDashboardWidgetPrefs('{broken')).toEqual({ hidden: [] })
    expect(parseDashboardWidgetPrefs(JSON.stringify({ hidden: 'ball' }))).toEqual({ hidden: [] })
  })
})

describe('DASHBOARD_WIDGETS — 選べる項目', () => {
  it('新しく足した「期限切れ」「確定事項」「最近のコメント」を含む', () => {
    const labels = DASHBOARD_WIDGETS.map((w) => w.label)
    expect(labels).toContain('期限切れ')
    expect(labels).toContain('確定事項')
    expect(labels).toContain('最近のコメント')
  })

  it('確定事項は期限切れのすぐ下に並ぶ（画面の上からの順と同じ）', () => {
    const ids = DASHBOARD_WIDGETS.map((w) => w.id)
    expect(ids.indexOf('decisions')).toBe(ids.indexOf('overdue') + 1)
  })

  it('項目の id は重ならない', () => {
    const ids = DASHBOARD_WIDGETS.map((w) => w.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('useDashboardWidgetPrefs — 出し入れしてブラウザに残す', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('はじめは全部出ている', () => {
    const { result } = renderHook(() => useDashboardWidgetPrefs())
    for (const widget of DASHBOARD_WIDGETS) {
      expect(result.current.isVisible(widget.id)).toBe(true)
    }
  })

  it('切り替えると隠れ、もう一度切り替えると出る。どちらもブラウザに残る', () => {
    const { result } = renderHook(() => useDashboardWidgetPrefs())

    act(() => result.current.toggle('ball'))
    expect(result.current.isVisible('ball')).toBe(false)
    expect(JSON.parse(localStorage.getItem(DASHBOARD_WIDGET_PREFS_KEY) ?? '{}')).toEqual({ hidden: ['ball'] })

    act(() => result.current.toggle('ball'))
    expect(result.current.isVisible('ball')).toBe(true)
    expect(JSON.parse(localStorage.getItem(DASHBOARD_WIDGET_PREFS_KEY) ?? '{}')).toEqual({ hidden: [] })
  })

  it('開き直しても、前に隠した項目は隠れたまま', () => {
    localStorage.setItem(DASHBOARD_WIDGET_PREFS_KEY, JSON.stringify({ hidden: ['meetings'] }))
    const { result } = renderHook(() => useDashboardWidgetPrefs())
    expect(result.current.isVisible('meetings')).toBe(false)
    expect(result.current.isVisible('overdue')).toBe(true)
  })
})
