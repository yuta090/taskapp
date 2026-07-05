export interface PortalActivityNotificationRow {
  id: string
  type: string
  payload: { message?: string; task_id?: string }
  created_at: string
}

export interface PortalActivityCompletedTaskRow {
  id: string
  title: string
  completed_at: string | null
  updated_at: string
}

export interface PortalActivityInput {
  notifications: PortalActivityNotificationRow[]
  completedTasks: PortalActivityCompletedTaskRow[]
  /**
   * このクライアントに現在見えるタスクIDの集合（RLS越しの select id で作る）。
   * 渡された場合、集合に無い task_id を指す通知はリンク化しない
   * （削除済み・非公開タスクへのデッドリンク=404 を防ぐ）。
   */
  visibleTaskIds?: Set<string>
}

export interface PortalActivity {
  id: string
  type: 'task_completed' | 'comment' | 'milestone' | 'notification'
  message: string
  timestamp: string
  /** Task the activity is about, if any — lets the feed link to `/portal/task/[taskId]`. */
  taskId?: string
}

const DEFAULT_LIMIT = 10

/**
 * B-3: builds the portal dashboard's activity feed, carrying `task_id`
 * through from notification payloads / completed tasks so feed items can
 * link to the task instead of being plain text.
 */
export function buildPortalActivities(
  { notifications, completedTasks, visibleTaskIds }: PortalActivityInput,
  limit = DEFAULT_LIMIT
): PortalActivity[] {
  const isLinkable = (taskId: string | undefined): taskId is string =>
    taskId !== undefined && (visibleTaskIds === undefined || visibleTaskIds.has(taskId))

  const notificationActivities: PortalActivity[] = notifications.map((n) => ({
    id: n.id,
    type: 'notification',
    message: n.payload?.message || `${n.type}の通知`,
    timestamp: n.created_at,
    taskId: isLinkable(n.payload?.task_id) ? n.payload?.task_id : undefined,
  }))

  const completedActivities: PortalActivity[] = completedTasks.map((t) => ({
    id: `completed-${t.id}`,
    type: 'task_completed',
    message: `「${t.title}」が完了しました`,
    timestamp: t.completed_at || t.updated_at,
    taskId: t.id,
  }))

  return [...notificationActivities, ...completedActivities]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit)
}
