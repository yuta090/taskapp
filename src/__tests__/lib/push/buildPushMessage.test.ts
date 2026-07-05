import { describe, it, expect } from 'vitest'
import { buildPushMessage, type PushNotificationRow } from '@/lib/push/buildPushMessage'

function makeRow(overrides: Partial<PushNotificationRow> = {}): PushNotificationRow {
  return {
    id: 'notif-1',
    org_id: 'org-1',
    space_id: 'space-1',
    type: 'ball_passed',
    payload: {},
    ...overrides,
  }
}

describe('buildPushMessage', () => {
  it('labels ball_passed', () => {
    const msg = buildPushMessage(makeRow({ type: 'ball_passed' }), 'internal')
    expect(msg.title).toBe('ボールがあなたに渡されました')
  })

  it('labels review_request', () => {
    const msg = buildPushMessage(makeRow({ type: 'review_request' }), 'internal')
    expect(msg.title).toBe('承認依頼が届きました')
  })

  it('labels confirmation_request', () => {
    const msg = buildPushMessage(makeRow({ type: 'confirmation_request' }), 'client')
    expect(msg.title).toBe('確認依頼が届きました')
  })

  it('labels urgent_confirmation', () => {
    const msg = buildPushMessage(makeRow({ type: 'urgent_confirmation' }), 'client')
    expect(msg.title).toBe('至急の確認依頼があります')
  })

  it('labels task_assigned', () => {
    const msg = buildPushMessage(makeRow({ type: 'task_assigned' }), 'internal')
    expect(msg.title).toBe('タスクが割り当てられました')
  })

  it('labels spec_decision_needed', () => {
    const msg = buildPushMessage(makeRow({ type: 'spec_decision_needed' }), 'internal')
    expect(msg.title).toBe('仕様の決定が必要です')
  })

  it('falls back to a generic title for unknown types', () => {
    const msg = buildPushMessage(makeRow({ type: 'something_unknown' }), 'internal')
    expect(msg.title).toBe('新しい通知があります')
  })

  it('uses payload.message as the body', () => {
    const msg = buildPushMessage(makeRow({ payload: { message: 'タスクAを確認してください' } }), 'internal')
    expect(msg.body).toBe('タスクAを確認してください')
  })

  it('falls back to an empty body when there is no message', () => {
    const msg = buildPushMessage(makeRow({ payload: {} }), 'internal')
    expect(msg.body).toBe('')
  })

  it('builds an internal deep link when task_id is present', () => {
    const msg = buildPushMessage(makeRow({ payload: { task_id: 'task-1' } }), 'internal')
    expect(msg.url).toBe('/org-1/project/space-1?task=task-1')
  })

  it('falls back to /inbox for internal recipients without a task_id', () => {
    const msg = buildPushMessage(makeRow({ payload: {} }), 'internal')
    expect(msg.url).toBe('/inbox')
  })

  it('builds a portal task link when task_id is present for client recipients', () => {
    const msg = buildPushMessage(makeRow({ payload: { task_id: 'task-1' } }), 'client')
    expect(msg.url).toBe('/portal/task/task-1')
  })

  it('falls back to /portal for client recipients without a task_id', () => {
    const msg = buildPushMessage(makeRow({ payload: {} }), 'client')
    expect(msg.url).toBe('/portal')
  })

  it('tags the message with the notification id', () => {
    const msg = buildPushMessage(makeRow({ id: 'notif-42' }), 'internal')
    expect(msg.tag).toBe('taskapp-notif-42')
  })
})
