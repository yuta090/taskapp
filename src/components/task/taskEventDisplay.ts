import type { TaskEvent } from '@/types/database'

/** Human-readable Japanese label for a task_events action. */
const ACTION_LABELS: Record<string, string> = {
  TASK_CREATE: 'タスク作成',
  TASK_UPDATE: '更新',
  PASS_BALL: 'ボールを渡した',
  SET_OWNERS: '担当を変更',
  CONSIDERING_DECIDE: '決定を登録',
  SPEC_DECIDE: '仕様を決定',
  SPEC_IMPLEMENT: '実装済みにした',
  REVIEW_OPEN: 'レビュー依頼',
  REVIEW_APPROVE: 'レビュー承認',
  REVIEW_BLOCK: '差し戻し',
  MEETING_START: '会議開始',
  MEETING_END: '会議終了',
}

export function eventActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action
}

function payloadOf(event: TaskEvent): Record<string, unknown> {
  return (event.payload as Record<string, unknown> | null) ?? {}
}

/** The most relevant free-text detail for an event, or null if none. */
export function eventDetailText(event: TaskEvent): string | null {
  const p = payloadOf(event)
  const candidate =
    (p.blockedReason as string | undefined) ??
    (p.decisionText as string | undefined) ??
    (p.reason as string | undefined)
  return candidate && candidate.trim() ? candidate : null
}

/** True when a decision was recorded on behalf of the client (audit-critical). */
export function isClientDecision(event: TaskEvent): boolean {
  return payloadOf(event).onBehalfOf === 'client'
}

/** True when the event was produced inside a meeting (evidence). */
export function isMeetingEvent(event: TaskEvent): boolean {
  return event.meeting_id != null
}
