import { describe, it, expect } from 'vitest'
import {
  categorizeNotificationType,
  buildDigest,
  CATEGORY_LABEL,
  type NotificationEmailPrefs,
  type DigestNotification,
} from '@/lib/notifications/digest'

const allOn: NotificationEmailPrefs = {
  email_enabled: true,
  on_task_assigned: true,
  on_task_mentioned: true,
  on_review_request: true,
  on_client_response: true,
  on_meeting_reminder: true,
  digest_frequency: 'daily',
}

function n(type: string, payload: Record<string, unknown> = {}, space_name = 'PJ-A'): DigestNotification {
  return { type, payload, space_name, created_at: '2026-07-26T00:00:00Z' }
}

describe('categorizeNotificationType', () => {
  it('割り当て系→task_assigned', () => {
    expect(categorizeNotificationType('task_assigned')).toBe('task_assigned')
    expect(categorizeNotificationType('ball_passed')).toBe('task_assigned')
  })
  it('承認系→review_request', () => {
    expect(categorizeNotificationType('review_request')).toBe('review_request')
    expect(categorizeNotificationType('confirmation_request')).toBe('review_request')
    expect(categorizeNotificationType('spec_decision_needed')).toBe('review_request')
  })
  it('会議系→meeting_reminder', () => {
    expect(categorizeNotificationType('scheduling_reminder')).toBe('meeting_reminder')
    expect(categorizeNotificationType('meeting_ended')).toBe('meeting_reminder')
  })
  it('未知の型は null（ダイジェストに含めない）', () => {
    expect(categorizeNotificationType('some_unknown_type')).toBeNull()
  })
})

describe('buildDigest', () => {
  it('種類別に集約し、順序・ラベル・件数を返す', () => {
    const d = buildDigest([
      n('task_assigned', { title: '請求書送付' }),
      n('ball_passed', { task_title: '契約確認' }),
      n('review_request', { title: '見積レビュー' }),
      n('scheduling_reminder', { meeting_title: 'キックオフ' }),
    ], allOn)
    expect(d).not.toBeNull()
    expect(d!.totalCount).toBe(4)
    expect(d!.sections[0].category).toBe('task_assigned')
    expect(d!.sections[0].items).toHaveLength(2)
    expect(d!.sections[0].items[0].title).toBe('請求書送付')
    expect(d!.sections[0].items[1].title).toBe('契約確認') // task_title フォールバック
    expect(d!.sections[0].label).toBe(CATEGORY_LABEL.task_assigned)
  })

  it('種類別トグルOFFのカテゴリは除外', () => {
    const prefs = { ...allOn, on_review_request: false }
    const d = buildDigest([
      n('task_assigned', { title: 'A' }),
      n('review_request', { title: 'B' }),
    ], prefs)
    expect(d!.totalCount).toBe(1)
    expect(d!.sections.map(s => s.category)).toEqual(['task_assigned'])
  })

  it('email_enabled=false なら null（送らない）', () => {
    expect(buildDigest([n('task_assigned')], { ...allOn, email_enabled: false })).toBeNull()
  })

  it("digest_frequency='none' なら null", () => {
    expect(buildDigest([n('task_assigned')], { ...allOn, digest_frequency: 'none' })).toBeNull()
  })

  it('該当通知が0件なら null（空メールを送らない）', () => {
    expect(buildDigest([n('some_unknown_type')], allOn)).toBeNull()
    expect(buildDigest([], allOn)).toBeNull()
  })

  it('タイトルが無ければフォールバック文言', () => {
    const d = buildDigest([n('task_assigned', {})], allOn)
    expect(d!.sections[0].items[0].title).toBe('(タイトルなし)')
  })
})
