// 通知プロバイダー抽象化 — Slack, Google Chat 等を統一的に扱う

export type NotificationEventType =
  | 'task_created'
  | 'task_updated'
  | 'ball_passed'
  | 'status_changed'
  | 'comment_added'
  | 'review_opened'
  | 'meeting_ended'
  | 'task_shared' // UI手動共有
  | 'scheduling_proposal_created'
  | 'scheduling_response_submitted'
  | 'scheduling_slot_confirmed'
  | 'scheduling_proposal_expired'
  | 'scheduling_reminder'

export interface NotificationContext {
  orgId: string
  spaceId: string
  taskId?: string
  actorId?: string
  meetingId?: string
}

export interface TaskNotificationPayload {
  task: {
    id: string
    title: string
    status: string
    ball: 'client' | 'internal'
    origin: 'client' | 'internal'
    type: 'task' | 'spec'
    dueDate?: string | null
    assigneeName?: string | null
    description?: string | null
  }
  spaceName: string
  actorName?: string
  customMessage?: string
  appUrl: string
  changes?: {
    oldStatus?: string
    newStatus?: string
    oldBall?: string
    newBall?: string
    commentBody?: string
  }
}

export interface NotificationResult {
  messageId: string | null
  error?: string
}

export interface NotificationProvider {
  readonly name: string
  isConfigured(): boolean
  isSpaceConfigured(spaceId: string): Promise<boolean>
  sendTaskNotification(
    event: NotificationEventType,
    context: NotificationContext,
    payload: TaskNotificationPayload,
  ): Promise<NotificationResult>
}
