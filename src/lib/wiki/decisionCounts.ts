/**
 * Wiki 一覧に出す「確定 2/5」の数え方。
 *
 * 確定の単位はページではなく**決定1件**（＝そのページに紐づく `type='spec'` のタスク）。
 * ページ自身に状態の列は足さない。列を足すと決定側と必ずずれ、正本が2つになる。
 * ここはそのページに紐づくタスクを数えて印にするだけ。
 *
 * 決定事項のタスクが1件も無いページ（検討資料・議事メモ）には印を出さない。
 * 全部に「検討中」を貼ると印の意味が薄れる。
 */

import type { DecisionState } from '@/types/database'

export interface SpecTaskRow {
  wiki_page_id: string | null
  decision_state: DecisionState | null
}

export interface DecisionCount {
  /** そのページに紐づく決定事項のタスクの数 */
  total: number
  /** そのうち決まったもの（decided と implemented） */
  decided: number
}

export type DecisionCountsByPage = Record<string, DecisionCount>

export function buildDecisionCounts(rows: readonly SpecTaskRow[]): DecisionCountsByPage {
  const counts: DecisionCountsByPage = {}
  for (const row of rows) {
    if (!row.wiki_page_id) continue
    const current = counts[row.wiki_page_id] ?? { total: 0, decided: 0 }
    current.total += 1
    // 実装済みは「決まったあとの先の話」なので確定に数える。
    // 状態が入っていない行も total には数える（印を実態より良く見せない）。
    if (row.decision_state === 'decided' || row.decision_state === 'implemented') {
      current.decided += 1
    }
    counts[row.wiki_page_id] = current
  }
  return counts
}

export interface DecisionChip {
  text: string
  /** 全部そろったか（見た目を塗りつぶすかどうか） */
  complete: boolean
}

export function decisionChipLabel(count: DecisionCount | undefined): DecisionChip | null {
  if (!count || count.total === 0) return null
  return {
    text: `確定 ${count.decided}/${count.total}`,
    complete: count.decided === count.total,
  }
}
