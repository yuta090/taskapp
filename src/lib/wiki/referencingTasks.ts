/**
 * Wiki のページ情報に出す「このページを参照しているタスク」の組み立て。
 *
 * 参照は2種類ある。
 *  1. 仕様書連携: tasks.wiki_page_id がこのページ（TaskInspector の「仕様書」欄で選んだもの）
 *  2. 説明文のリンク: tasks.description にこのページへのリンク（`wiki?page=<id>`）を貼ったもの
 * 同じタスクが両方に当たることがあるので、ここで1件にまとめて並べる。
 */

import type { TaskStatus } from '@/types/database'

/** 取る列。行の表示（番号・題名・状態・担当者）とリンク先に要るものだけ */
export const REFERENCING_TASK_COLUMNS = 'id, org_id, space_id, short_id, title, status, assignee_id'

/**
 * 1本のクエリで取る上限。1ページを参照するタスクが100件を超えることは想定していない。
 * 上限を付けないと、説明文の検索が当たりすぎたときに PostgREST の max_rows（1000）まで読んでしまう。
 */
export const REFERENCING_TASKS_LIMIT = 100

export interface ReferencingTaskRow {
  id: string
  org_id: string
  space_id: string
  short_id: number | null
  title: string
  status: TaskStatus
  assignee_id: string | null
}

/** ページ情報パネルに渡す1行。担当者の名前は呼び出し側がメンバー一覧から引いて付ける */
export interface WikiReferencingTask extends ReferencingTaskRow {
  /** 担当者がいないときは null */
  assigneeName: string | null
}

/**
 * 説明文からこのページへのリンクを探す ilike のパターン。
 * 絶対URL（https://…/wiki?page=<id>）でも相対リンクでも `wiki?page=<id>` の部分は共通なので、そこで探す。
 * ページの id は UUID なので特殊文字は入らないが、`_` は ilike では「任意の1文字」になるため念のため逃がす。
 */
export function wikiPageLinkPattern(pageId: string): string {
  const escaped = pageId.replace(/[\\%_]/g, (ch) => `\\${ch}`)
  return `%wiki?page=${escaped}%`
}

const STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: 'バックログ',
  todo: '着手予定',
  in_progress: '進行中',
  in_review: '社内承認中',
  considering: '検討中',
  done: '完了',
}

/** 状態の表示名。タスク一覧の行（TaskRow）と同じ言葉にそろえる */
export function referencingTaskStatusLabel(status: TaskStatus): string {
  return STATUS_LABELS[status] ?? status
}

/**
 * 2種類の参照をまとめて並べる。未完了を先に出し、その中は番号の新しい順。
 * 完了したタスクは読み手がまず見たいものではないので最後に回す。
 */
export function mergeReferencingTasks<T extends ReferencingTaskRow>(
  linked: readonly T[],
  described: readonly T[]
): T[] {
  const byId = new Map<string, T>()
  for (const row of [...linked, ...described]) {
    if (!byId.has(row.id)) byId.set(row.id, row)
  }
  return [...byId.values()].sort((a, b) => {
    const doneA = a.status === 'done' ? 1 : 0
    const doneB = b.status === 'done' ? 1 : 0
    if (doneA !== doneB) return doneA - doneB
    // 採番前（short_id が無い）のタスクは同じ状態の中で最後
    if (a.short_id == null || b.short_id == null) {
      return (a.short_id == null ? 1 : 0) - (b.short_id == null ? 1 : 0)
    }
    return b.short_id - a.short_id
  })
}
