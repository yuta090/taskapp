import { describe, it, expect, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  DASHBOARD_WIDGETS,
  DASHBOARD_WIDGET_PREFS_KEY,
  groupVisibleWidgets,
  parseDashboardWidgetPrefs,
  resolveWidgetOrder,
  useDashboardWidgetPrefs,
  type DashboardWidgetId,
} from './widgetPrefs'

/** 並び替えの対象（kpi_ball は kpi の付属なので入らない）の既定順 */
const DEFAULT_ORDER = DASHBOARD_WIDGETS.filter((w) => w.id !== 'kpi_ball').map((w) => w.id)

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

describe('DASHBOARD_WIDGETS — 最近のアクティビティ', () => {
  it('「最近のアクティビティ」は「最近のコメント」のすぐ下に並ぶ', () => {
    const ids = DASHBOARD_WIDGETS.map((w) => w.id)
    expect(DASHBOARD_WIDGETS.find((w) => w.id === 'activity')?.label).toBe('最近のアクティビティ')
    expect(ids.indexOf('activity')).toBe(ids.indexOf('recent_comments') + 1)
  })
})

describe('parseDashboardWidgetPrefs — 並び順', () => {
  it('並び順が無い古い保存値も読める（order は付かない）', () => {
    const parsed = parseDashboardWidgetPrefs(JSON.stringify({ hidden: ['ball'] }))
    expect(parsed.hidden).toEqual(['ball'])
    expect(parsed.order).toBeUndefined()
  })

  it('保存した並び順を読む', () => {
    const parsed = parseDashboardWidgetPrefs(JSON.stringify({ hidden: [], order: ['meetings', 'kpi'] }))
    expect(parsed.order).toEqual(['meetings', 'kpi'])
  })

  it('知らない id・重複・文字列以外は捨てる。kpi_ball は並び替えの対象外なので捨てる', () => {
    const parsed = parseDashboardWidgetPrefs(
      JSON.stringify({ hidden: [], order: ['kpi', 'removed', 'kpi', 3, 'kpi_ball', 'overdue'] })
    )
    expect(parsed.order).toEqual(['kpi', 'overdue'])
  })

  it('order が配列でなければ無いものとして扱う', () => {
    expect(parseDashboardWidgetPrefs(JSON.stringify({ hidden: ['ball'], order: 'kpi' })).order).toBeUndefined()
  })
})

describe('resolveWidgetOrder — 保存した順に、足りない項目を差し込む', () => {
  it('保存が無ければ既定順（kpi_ball を除く10項目）', () => {
    expect(resolveWidgetOrder(undefined)).toEqual(DEFAULT_ORDER)
    expect(DEFAULT_ORDER).toHaveLength(10)
    expect(DEFAULT_ORDER).not.toContain('kpi_ball')
  })

  it('保存した順に並べる', () => {
    const saved = [...DEFAULT_ORDER].reverse()
    expect(resolveWidgetOrder(saved)).toEqual(saved)
  })

  it('保存に無い項目は、既定順で直前にある項目のすぐ後ろに入る', () => {
    // activity（最近のコメントの直後）を知らない古い保存値
    const saved = DEFAULT_ORDER.filter((id) => id !== 'activity').reverse()
    const resolved = resolveWidgetOrder(saved)
    expect(resolved.indexOf('activity')).toBe(resolved.indexOf('recent_comments') + 1)
    expect(resolved).toHaveLength(DEFAULT_ORDER.length)
  })

  it('直前の項目も保存に無ければ、その項目の後ろに続けて入る（既定順を保つ）', () => {
    // activity と client_follow_up（recent_comments の次の次）が両方無い
    const saved: DashboardWidgetId[] = ['meetings', 'recent_comments', 'kpi']
    const resolved = resolveWidgetOrder(saved)
    const at = resolved.indexOf('recent_comments')
    expect(resolved.slice(at, at + 3)).toEqual(['recent_comments', 'activity', 'client_follow_up'])
  })

  it('直前が無い項目（既定の先頭）が保存に無ければ、先頭に入る', () => {
    const saved = DEFAULT_ORDER.filter((id) => id !== 'kpi')
    expect(resolveWidgetOrder(saved)[0]).toBe('kpi')
  })

  it('不明な id・重複・kpi_ball は捨てる', () => {
    const saved = ['overdue', 'overdue', 'kpi_ball', 'nope', 'kpi'] as unknown as DashboardWidgetId[]
    const resolved = resolveWidgetOrder(saved)
    expect(resolved.filter((id) => id === 'overdue')).toHaveLength(1)
    expect(resolved).not.toContain('kpi_ball')
    expect(resolved.indexOf('overdue')).toBeLessThan(resolved.indexOf('kpi'))
    expect(new Set(resolved).size).toBe(resolved.length)
    expect(resolved).toHaveLength(DEFAULT_ORDER.length)
  })
})

describe('groupVisibleWidgets — 半幅の項目が続いた区間だけ 2 列格子にする', () => {
  const all = () => true

  it('既定順では、最後の半幅4つが1つの格子になる', () => {
    const runs = groupVisibleWidgets(DEFAULT_ORDER, all)
    const last = runs[runs.length - 1]
    expect(last).toEqual({ kind: 'grid', ids: ['milestones', 'ball', 'upcoming_deadlines', 'meetings'] })
    expect(runs.slice(0, -1).every((r) => r.kind === 'single')).toBe(true)
  })

  it('半幅の項目が間で切れていれば、それぞれ別の格子になる', () => {
    const runs = groupVisibleWidgets(['milestones', 'ball', 'overdue', 'meetings'], all)
    expect(runs).toEqual([
      { kind: 'grid', ids: ['milestones', 'ball'] },
      { kind: 'single', id: 'overdue' },
      { kind: 'grid', ids: ['meetings'] },
    ])
  })

  it('隠した項目は飛ばして数える（間の項目が隠れていれば、前後の半幅は同じ格子）', () => {
    const runs = groupVisibleWidgets(['milestones', 'overdue', 'ball'], (id) => id !== 'overdue')
    expect(runs).toEqual([{ kind: 'grid', ids: ['milestones', 'ball'] }])
  })

  it('全部隠れていれば空', () => {
    expect(groupVisibleWidgets(DEFAULT_ORDER, () => false)).toEqual([])
  })
})

describe('useDashboardWidgetPrefs — 並び替え', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  const stored = () => JSON.parse(localStorage.getItem(DASHBOARD_WIDGET_PREFS_KEY) ?? '{}')

  it('はじめは既定順', () => {
    const { result } = renderHook(() => useDashboardWidgetPrefs())
    expect(result.current.order).toEqual(DEFAULT_ORDER)
  })

  it('move(id, 1) で1つ下へ、move(id, -1) で1つ上へ動き、ブラウザに残る', () => {
    const { result } = renderHook(() => useDashboardWidgetPrefs())
    act(() => result.current.move('kpi', 1))
    expect(result.current.order.slice(0, 2)).toEqual(['overdue', 'kpi'])
    expect(stored().order.slice(0, 2)).toEqual(['overdue', 'kpi'])

    act(() => result.current.move('kpi', -1))
    expect(result.current.order).toEqual(DEFAULT_ORDER)
  })

  it('先頭を上へ・末尾を下へは動かない', () => {
    const { result } = renderHook(() => useDashboardWidgetPrefs())
    act(() => result.current.move('kpi', -1))
    expect(result.current.order).toEqual(DEFAULT_ORDER)
    act(() => result.current.move('meetings', 1))
    expect(result.current.order).toEqual(DEFAULT_ORDER)
  })

  it('moveTo(id, beforeId) は、その項目の前に移る', () => {
    const { result } = renderHook(() => useDashboardWidgetPrefs())
    act(() => result.current.moveTo('meetings', 'overdue'))
    expect(result.current.order.slice(0, 3)).toEqual(['kpi', 'meetings', 'overdue'])
    expect(result.current.order).toHaveLength(DEFAULT_ORDER.length)
  })

  it('moveTo(id, null) は末尾に移る', () => {
    const { result } = renderHook(() => useDashboardWidgetPrefs())
    act(() => result.current.moveTo('kpi', null))
    expect(result.current.order[result.current.order.length - 1]).toBe('kpi')
    expect(result.current.order).toHaveLength(DEFAULT_ORDER.length)
  })

  it('moveTo で自分自身の前に落としても変わらない', () => {
    const { result } = renderHook(() => useDashboardWidgetPrefs())
    act(() => result.current.moveTo('overdue', 'overdue'))
    expect(result.current.order).toEqual(DEFAULT_ORDER)
  })

  it('resetOrder で既定順に戻り、保存から order が消える。隠した項目は残る', () => {
    const { result } = renderHook(() => useDashboardWidgetPrefs())
    act(() => result.current.toggle('ball'))
    act(() => result.current.move('kpi', 1))
    act(() => result.current.resetOrder())
    expect(result.current.order).toEqual(DEFAULT_ORDER)
    expect(stored()).toEqual({ hidden: ['ball'] })
  })

  it('並べ替えても、隠した項目は隠れたまま。隠し直しても並び順は残る', () => {
    const { result } = renderHook(() => useDashboardWidgetPrefs())
    act(() => result.current.toggle('ball'))
    act(() => result.current.move('kpi', 1))
    expect(result.current.isVisible('ball')).toBe(false)
    act(() => result.current.toggle('meetings'))
    expect(result.current.order.slice(0, 2)).toEqual(['overdue', 'kpi'])
  })

  it('開き直しても、前に並べた順のまま。あとから足した項目は既定の位置に入る', () => {
    const saved = DEFAULT_ORDER.filter((id) => id !== 'activity').reverse()
    localStorage.setItem(DASHBOARD_WIDGET_PREFS_KEY, JSON.stringify({ hidden: [], order: saved }))
    const { result } = renderHook(() => useDashboardWidgetPrefs())
    const order = result.current.order
    expect(order.indexOf('activity')).toBe(order.indexOf('recent_comments') + 1)
    expect(order.filter((id) => id !== 'activity')).toEqual(saved)
  })

  it('kpi_ball は並び替えの対象外（動かそうとしても何も起きない）', () => {
    const { result } = renderHook(() => useDashboardWidgetPrefs())
    act(() => result.current.move('kpi_ball', 1))
    act(() => result.current.moveTo('kpi_ball', 'overdue'))
    expect(result.current.order).toEqual(DEFAULT_ORDER)
  })
})
