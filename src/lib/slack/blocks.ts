import type { TaskNotificationPayload, NotificationEventType } from '@/lib/notifications/types'

const STATUS_LABELS: Record<string, string> = {
  backlog: '未着手',
  todo: 'ToDo',
  in_progress: '進行中',
  in_review: 'レビュー中',
  done: '完了',
  considering: '検討中',
  decided: '決定済み',
  implemented: '実装済み',
}

const BALL_LABELS: Record<string, string> = {
  client: '外部',
  internal: '社内',
}

const EVENT_LABELS: Record<NotificationEventType, string> = {
  task_created: 'タスクが作成されました',
  task_updated: 'タスクが更新されました',
  ball_passed: 'ボールが移動しました',
  status_changed: 'ステータスが変更されました',
  comment_added: 'コメントが追加されました',
  review_opened: 'レビューが開始されました',
  meeting_ended: 'ミーティングが終了しました',
  task_shared: 'タスクが共有されました',
  scheduling_proposal_created: '日程調整が作成されました',
  scheduling_response_submitted: '日程調整に回答がありました',
  scheduling_slot_confirmed: '日程が確定しました',
  scheduling_proposal_expired: '日程調整が期限切れになりました',
  scheduling_reminder: '日程調整のリマインダー',
}

/**
 * Slack Block Kit メッセージを構築
 */
export function buildTaskBlocks(
  event: NotificationEventType,
  payload: TaskNotificationPayload,
): unknown[] {
  const { task, spaceName, actorName, customMessage, appUrl } = payload
  const taskUrl = `${appUrl}/tasks?task=${task.id}`

  const blocks: unknown[] = []

  // Header
  blocks.push({
    type: 'header',
    text: {
      type: 'plain_text',
      text: EVENT_LABELS[event] || 'タスク通知',
      emoji: true,
    },
  })

  // Context
  const contextElements: unknown[] = []
  if (actorName) {
    contextElements.push({ type: 'mrkdwn', text: `*${actorName}*` })
  }
  contextElements.push({ type: 'mrkdwn', text: `${spaceName}` })
  if (task.ball === 'client') {
    contextElements.push({ type: 'mrkdwn', text: '確認待ち' })
  }

  if (contextElements.length > 0) {
    blocks.push({ type: 'context', elements: contextElements })
  }

  // Task card
  const fields: unknown[] = [
    { type: 'mrkdwn', text: `*ステータス*\n${STATUS_LABELS[task.status] || task.status}` },
    { type: 'mrkdwn', text: `*ボール*\n${BALL_LABELS[task.ball] || task.ball}` },
  ]

  if (task.assigneeName) {
    fields.push({ type: 'mrkdwn', text: `*担当者*\n${task.assigneeName}` })
  }
  if (task.dueDate) {
    fields.push({ type: 'mrkdwn', text: `*期限*\n${task.dueDate}` })
  }

  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: `*<${taskUrl}|${task.title}>*` },
    fields,
  })

  // Event-specific context
  if (event === 'status_changed' && payload.changes?.oldStatus && payload.changes?.newStatus) {
    const oldLabel = STATUS_LABELS[payload.changes.oldStatus] || payload.changes.oldStatus
    const newLabel = STATUS_LABELS[payload.changes.newStatus] || payload.changes.newStatus
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*${oldLabel}* → *${newLabel}*` },
    })
  }

  if (event === 'ball_passed' && payload.changes?.newBall) {
    const direction = payload.changes.newBall === 'client'
      ? ':arrow_right: 外部'
      : ':arrow_left: 社内'
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `ボール移動: ${direction}` },
    })
  }

  if (event === 'comment_added' && payload.changes?.commentBody) {
    const truncated = payload.changes.commentBody.length > 300
      ? payload.changes.commentBody.slice(0, 300) + '...'
      : payload.changes.commentBody
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `> ${truncated}` },
    })
  }

  // Custom message
  if (customMessage) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: customMessage },
    })
  }

  // Description snippet
  if (task.description) {
    const truncated = task.description.length > 200
      ? task.description.slice(0, 200) + '...'
      : task.description
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: truncated },
    })
  }

  blocks.push({ type: 'divider' })

  return blocks
}

/**
 * 通知のフォールバックテキスト
 */
export function buildTaskFallbackText(
  event: NotificationEventType,
  payload: TaskNotificationPayload,
): string {
  const { task, actorName } = payload
  const label = EVENT_LABELS[event] || 'タスク通知'
  const actor = actorName ? `${actorName}: ` : ''
  return `${actor}${label} - ${task.title}`
}
