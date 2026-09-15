'use client'

/**
 * ダッシュボードに出す項目の選択。ブラウザ単位（localStorage）で保存し、どのプロジェクトでも同じ設定を使う。
 *
 * 保存するのは「隠した項目」の一覧。「出す項目」を保存すると、あとから項目を足したときに、
 * 前に設定を触った人の画面には新しい項目が出てこなくなるため。
 *
 * 保存・復元の作法は Wiki 一覧の表示設定（src/lib/wiki/listPrefs.ts）と同じ:
 * 遅延初期化で localStorage を読み、変更のたびに書き込む。
 *
 * サーバーでは localStorage が読めず「全部出す」になる。今は設定で変わる部分がすべて「読み込み中」の
 * 表示の後ろにあり、サーバーでもブラウザの最初の描画でも同じ出力なので、ずれない。サーバーでデータを
 * 先読みする・設定で変わる表示をヘッダーに足す、のどちらかをするときは、読むのをマウント後にする。
 */
import { useCallback, useState } from 'react'

export type DashboardWidgetId =
  | 'kpi'
  | 'overdue'
  | 'recent_comments'
  | 'client_follow_up'
  | 'milestones'
  | 'ball'
  | 'upcoming_deadlines'
  | 'meetings'

/** メニューに並べる順（画面の上からの順と同じ） */
export const DASHBOARD_WIDGETS: ReadonlyArray<{ id: DashboardWidgetId; label: string }> = [
  { id: 'kpi', label: '件数のまとめ' },
  { id: 'overdue', label: '期限切れ' },
  { id: 'recent_comments', label: '最近のコメント' },
  { id: 'client_follow_up', label: 'クライアント確認が必要' },
  { id: 'milestones', label: 'マイルストーン進捗' },
  { id: 'ball', label: 'ボール所在' },
  { id: 'upcoming_deadlines', label: '期限が近いタスク' },
  { id: 'meetings', label: '直近の予定' },
]

export const DASHBOARD_WIDGET_PREFS_KEY = 'dashboard-widgets:v1'

export interface DashboardWidgetPrefs {
  hidden: DashboardWidgetId[]
}

const DEFAULT_PREFS: DashboardWidgetPrefs = { hidden: [] }

const VALID_IDS: ReadonlySet<string> = new Set(DASHBOARD_WIDGETS.map((w) => w.id))

function isWidgetId(value: unknown): value is DashboardWidgetId {
  return typeof value === 'string' && VALID_IDS.has(value)
}

/** 壊れた JSON は全部出す。知らない項目名（項目を減らしたあとの古い保存値）は捨てる。 */
export function parseDashboardWidgetPrefs(raw: string | null): DashboardWidgetPrefs {
  if (raw == null || raw.trim() === '') return DEFAULT_PREFS
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_PREFS
    const hidden = (parsed as Record<string, unknown>).hidden
    if (!Array.isArray(hidden)) return DEFAULT_PREFS
    return { hidden: hidden.filter(isWidgetId) }
  } catch {
    return DEFAULT_PREFS
  }
}

function readStored(): DashboardWidgetPrefs {
  if (typeof window === 'undefined') return DEFAULT_PREFS
  try {
    return parseDashboardWidgetPrefs(localStorage.getItem(DASHBOARD_WIDGET_PREFS_KEY))
  } catch {
    return DEFAULT_PREFS
  }
}

function writeStored(prefs: DashboardWidgetPrefs) {
  try {
    localStorage.setItem(DASHBOARD_WIDGET_PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // プライベートモード等でストレージが使えなくても、このページを開いているあいだは state で効く
  }
}

export interface DashboardWidgetPrefsApi {
  isVisible: (id: DashboardWidgetId) => boolean
  toggle: (id: DashboardWidgetId) => void
}

export function useDashboardWidgetPrefs(): DashboardWidgetPrefsApi {
  const [prefs, setPrefs] = useState<DashboardWidgetPrefs>(readStored)

  const isVisible = useCallback((id: DashboardWidgetId) => !prefs.hidden.includes(id), [prefs])

  const toggle = useCallback((id: DashboardWidgetId) => {
    setPrefs((prev) => {
      const hidden = prev.hidden.includes(id) ? prev.hidden.filter((h) => h !== id) : [...prev.hidden, id]
      const next = { hidden }
      writeStored(next)
      return next
    })
  }, [])

  return { isVisible, toggle }
}
