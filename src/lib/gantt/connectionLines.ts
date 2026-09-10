/**
 * Gantt Chart - Parent/Child Connection Lines
 *
 * 親子タスクをつなぐ接続線の位置を計算する。以前は行(rowData)ごとに
 * `rowData.find(...)` で親を探しており、行数×行数のO(n^2)になっていた
 * (加えて描画のたびに再計算されていた)。ここでは taskId → row の
 * Map を1回だけ作って引くことで O(n) にする。
 */

import { GANTT_CONFIG } from './constants'
import { dateToX } from './dateUtils'
import type { Task } from '@/types/database'

export interface GanttRowDatum {
  type: 'header' | 'task'
  task?: Task
  rowIndex: number
}

export interface ConnectionLine {
  childTaskId: string
  parentEndX: number
  childStartX: number
  parentY: number
  childY: number
}

export function computeConnectionLines(
  rowData: GanttRowDatum[],
  startDate: Date,
  dayWidth: number
): ConnectionLine[] {
  // taskId → row の索引を1回だけ作る(親を探すたびに配列を舐めない)
  const rowByTaskId = new Map<string, GanttRowDatum>()
  rowData.forEach((row) => {
    if (row.type === 'task' && row.task) {
      rowByTaskId.set(row.task.id, row)
    }
  })

  const lines: ConnectionLine[] = []

  rowData.forEach((row) => {
    if (row.type !== 'task' || !row.task) return
    const childTask = row.task
    if (!childTask.parent_task_id) return
    const parentRow = rowByTaskId.get(childTask.parent_task_id)
    if (!parentRow || !parentRow.task) return

    const parentEnd = parentRow.task.due_date
    const childStart = childTask.start_date || childTask.created_at
    if (!parentEnd || !childStart) return

    const parentEndX = dateToX(new Date(parentEnd), startDate, dayWidth)
    const childStartX = dateToX(new Date(childStart), startDate, dayWidth)
    const parentY = parentRow.rowIndex * GANTT_CONFIG.ROW_HEIGHT + GANTT_CONFIG.ROW_HEIGHT / 2
    const childY = row.rowIndex * GANTT_CONFIG.ROW_HEIGHT + GANTT_CONFIG.ROW_HEIGHT / 2

    lines.push({ childTaskId: childTask.id, parentEndX, childStartX, parentY, childY })
  })

  return lines
}
