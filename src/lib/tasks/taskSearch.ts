import { TASK_NUMBER_PREFIX } from './taskNumber'

type SearchableTask = {
  title: string
  description?: string | null
  short_id?: number | null
}

// 「TP-42」「tp42」「#42」「42」を番号として読む。画面に出ている表記をそのまま貼っても引けるように
const TASK_NUMBER_QUERY = new RegExp(`^(?:${TASK_NUMBER_PREFIX}|#)?[-\\s]*(\\d+)$`, 'i')

/** タスク一覧の検索窓の判定。タイトル・説明の部分一致か、タスク番号の完全一致 */
export function matchesTaskSearch(task: SearchableTask, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true

  if (task.title.toLowerCase().includes(q)) return true
  if (task.description && task.description.toLowerCase().includes(q)) return true

  const m = q.match(TASK_NUMBER_QUERY)
  return m !== null && task.short_id != null && task.short_id === Number(m[1])
}
