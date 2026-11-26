'use client'

/**
 * ダッシュボードに出す項目の選択。ブラウザ単位（localStorage）で保存し、どのプロジェクトでも同じ設定を使う。
 *
 * 保存するのは「隠した項目」の一覧。「出す項目」を保存すると、あとから項目を足したときに、
 * 前に設定を触った人の画面には新しい項目が出てこなくなるため。
 * 並び順（order）も同じ考え方で、保存に無い項目は読むときに既定の位置へ差し込む（resolveWidgetOrder）。
 *
 * 保存・復元の作法は Wiki 一覧の表示設定（src/lib/wiki/listPrefs.ts）と同じ:
 * 遅延初期化で localStorage を読み、変更のたびに書き込む。
 *
 * サーバーでは localStorage が読めず「全部出す」になる。今は設定で変わる部分がすべて「読み込み中」の
 * 表示の後ろにあり、サーバーでもブラウザの最初の描画でも同じ出力なので、ずれない。サーバーでデータを
 * 先読みする・設定で変わる表示をヘッダーに足す、のどちらかをするときは、読むのをマウント後にする。
 */
import { useCallback, useMemo, useState } from 'react'

export type DashboardWidgetId =
  | 'kpi'
  | 'kpi_ball'
  | 'overdue'
  | 'decisions'
  | 'recent_comments'
  | 'activity'
  | 'client_follow_up'
  | 'milestones'
  | 'ball'
  | 'upcoming_deadlines'
  | 'meetings'

/** メニューに並べる順（画面の上からの順と同じ） */
export const DASHBOARD_WIDGETS: ReadonlyArray<{ id: DashboardWidgetId; label: string }> = [
  { id: 'kpi', label: '件数のまとめ' },
  // 件数のまとめの中の「ボール (社内/クライアント)」だけを隠す（ボールを使わない運用向け）
  { id: 'kpi_ball', label: 'ボール（件数のまとめ）' },
  { id: 'overdue', label: '期限切れ' },
  { id: 'decisions', label: '確定事項' },
  { id: 'recent_comments', label: '最近のコメント' },
  { id: 'activity', label: '最近のアクティビティ' },
  { id: 'client_follow_up', label: 'クライアント確認が必要' },
  { id: 'milestones', label: 'マイルストーン進捗' },
  { id: 'ball', label: 'ボール所在' },
  { id: 'upcoming_deadlines', label: '期限が近いタスク' },
  { id: 'meetings', label: '直近の予定' },
]

export const DASHBOARD_WIDGET_LABELS = Object.fromEntries(
  DASHBOARD_WIDGETS.map((w) => [w.id, w.label])
) as Record<DashboardWidgetId, string>

export const DASHBOARD_WIDGET_PREFS_KEY = 'dashboard-widgets:v1'

/** 並び替えの対象。「ボール（件数のまとめ）」は常に「件数のまとめ」の中の付属なので入れない */
export const ORDERABLE_WIDGET_IDS: readonly DashboardWidgetId[] = DASHBOARD_WIDGETS.filter(
  (w) => w.id !== 'kpi_ball'
).map((w) => w.id)

/** 2列の格子に並べる小さい項目 */
export const HALF_WIDTH_WIDGETS: readonly DashboardWidgetId[] = ['milestones', 'ball', 'upcoming_deadlines', 'meetings']

export interface DashboardWidgetPrefs {
  hidden: DashboardWidgetId[]
  /** 並べ替えたときだけ入る。古い保存値には無い */
  order?: DashboardWidgetId[]
}

const DEFAULT_PREFS: DashboardWidgetPrefs = { hidden: [] }

const VALID_IDS: ReadonlySet<string> = new Set(DASHBOARD_WIDGETS.map((w) => w.id))

function isWidgetId(value: unknown): value is DashboardWidgetId {
  return typeof value === 'string' && VALID_IDS.has(value)
}

const ORDERABLE_IDS: ReadonlySet<string> = new Set(ORDERABLE_WIDGET_IDS)

/** 知らない id・並び替えの対象外（kpi_ball）・重複を捨てる。順は保つ */
function sanitizeOrder(order: readonly unknown[]): DashboardWidgetId[] {
  const seen = new Set<string>()
  const result: DashboardWidgetId[] = []
  for (const id of order) {
    if (!isWidgetId(id) || !ORDERABLE_IDS.has(id) || seen.has(id)) continue
    seen.add(id)
    result.push(id)
  }
  return result
}

/**
 * 保存した並び順から、画面に使う並び順（対象の10項目すべて）を作る。
 * 保存に無い項目（あとから足した項目）は、既定順で直前にある項目のすぐ後ろに入れる。直前が無ければ先頭。
 */
export function resolveWidgetOrder(saved: readonly DashboardWidgetId[] | undefined): DashboardWidgetId[] {
  const result = sanitizeOrder(saved ?? [])
  ORDERABLE_WIDGET_IDS.forEach((id, index) => {
    if (result.includes(id)) return
    // 既定順で先に並ぶ項目は、保存にあるか、いまの繰り返しで差し込み済みなので、直前の項目は必ず result にある
    const previous = index > 0 ? result.indexOf(ORDERABLE_WIDGET_IDS[index - 1]) : -1
    result.splice(previous + 1, 0, id)
  })
  return result
}

/** 1つ上（-1）・下（1）へ動かす。端では動かさない */
function moveBy(order: DashboardWidgetId[], id: DashboardWidgetId, delta: -1 | 1): DashboardWidgetId[] {
  const from = order.indexOf(id)
  const to = from + delta
  if (from < 0 || to < 0 || to >= order.length) return order
  const next = [...order]
  next.splice(from, 1)
  next.splice(to, 0, id)
  return next
}

/** beforeId の前に移す。null は末尾 */
function moveBefore(order: DashboardWidgetId[], id: DashboardWidgetId, beforeId: DashboardWidgetId | null): DashboardWidgetId[] {
  if (id === beforeId || !order.includes(id)) return order
  const without = order.filter((o) => o !== id)
  const at = beforeId === null ? without.length : without.indexOf(beforeId)
  if (at < 0) return order
  without.splice(at, 0, id)
  return without
}

export type WidgetRun = { kind: 'single'; id: DashboardWidgetId } | { kind: 'grid'; ids: DashboardWidgetId[] }

/**
 * 並び順のうち見えている項目を、画面に描く単位に分ける。
 * 半幅の項目が続いた区間だけを 2 列格子にまとめ、間に別の項目があれば別々の格子になる。
 */
export function groupVisibleWidgets(
  order: readonly DashboardWidgetId[],
  isVisible: (id: DashboardWidgetId) => boolean
): WidgetRun[] {
  const runs: WidgetRun[] = []
  for (const id of order) {
    if (!isVisible(id)) continue
    if (HALF_WIDTH_WIDGETS.includes(id)) {
      const last = runs[runs.length - 1]
      if (last?.kind === 'grid') last.ids.push(id)
      else runs.push({ kind: 'grid', ids: [id] })
    } else {
      runs.push({ kind: 'single', id })
    }
  }
  return runs
}

/** 壊れた JSON は全部出す。知らない項目名（項目を減らしたあとの古い保存値）は捨てる。 */
export function parseDashboardWidgetPrefs(raw: string | null): DashboardWidgetPrefs {
  if (raw == null || raw.trim() === '') return DEFAULT_PREFS
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_PREFS
    const { hidden, order } = parsed as Record<string, unknown>
    if (!Array.isArray(hidden)) return DEFAULT_PREFS
    // 並び順は古い保存値には無い。配列でなければ無いものとして扱う
    return Array.isArray(order)
      ? { hidden: hidden.filter(isWidgetId), order: sanitizeOrder(order) }
      : { hidden: hidden.filter(isWidgetId) }
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
  /** 並び替えの対象の10項目すべての、いまの並び順（隠した項目も含む） */
  order: DashboardWidgetId[]
  /** 1つ上（-1）・下（1）へ動かす */
  move: (id: DashboardWidgetId, delta: -1 | 1) => void
  /** beforeId の前に移す。null は末尾 */
  moveTo: (id: DashboardWidgetId, beforeId: DashboardWidgetId | null) => void
  /** 並び順を既定に戻す（隠した項目はそのまま） */
  resetOrder: () => void
}

export function useDashboardWidgetPrefs(): DashboardWidgetPrefsApi {
  const [prefs, setPrefs] = useState<DashboardWidgetPrefs>(readStored)

  const isVisible = useCallback((id: DashboardWidgetId) => !prefs.hidden.includes(id), [prefs])
  const order = useMemo(() => resolveWidgetOrder(prefs.order), [prefs.order])

  const update = useCallback((change: (prev: DashboardWidgetPrefs) => DashboardWidgetPrefs) => {
    setPrefs((prev) => {
      const next = change(prev)
      if (next === prev) return prev
      writeStored(next)
      return next
    })
  }, [])

  const toggle = useCallback(
    (id: DashboardWidgetId) => {
      update((prev) => {
        const hidden = prev.hidden.includes(id) ? prev.hidden.filter((h) => h !== id) : [...prev.hidden, id]
        return { ...prev, hidden }
      })
    },
    [update]
  )

  const reorder = useCallback(
    (id: DashboardWidgetId, change: (current: DashboardWidgetId[]) => DashboardWidgetId[]) => {
      if (!ORDERABLE_IDS.has(id)) return
      update((prev) => {
        const current = resolveWidgetOrder(prev.order)
        const next = change(current)
        return next === current ? prev : { ...prev, order: next }
      })
    },
    [update]
  )

  const move = useCallback(
    (id: DashboardWidgetId, delta: -1 | 1) => reorder(id, (current) => moveBy(current, id, delta)),
    [reorder]
  )

  const moveTo = useCallback(
    (id: DashboardWidgetId, beforeId: DashboardWidgetId | null) =>
      reorder(id, (current) => moveBefore(current, id, beforeId)),
    [reorder]
  )

  const resetOrder = useCallback(() => {
    update((prev) => (prev.order === undefined ? prev : { hidden: prev.hidden }))
  }, [update])

  return { isVisible, toggle, order, move, moveTo, resetOrder }
}
