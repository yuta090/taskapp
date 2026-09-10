import { describe, it, expect } from 'vitest'
import {
  ALL_NOTIFICATION_TYPES,
  getDeliveryPolicy,
  isQuietHours,
  shouldSendPush,
  pushSkipReason,
  pushSkipReasonWithoutCount,
  PUSH_DAILY_CAP,
  QUIET_HOURS_EXEMPT_TYPES,
  EMAIL_IMMEDIATE_TYPES,
} from '@/lib/notifications/delivery'
import { NOTIFICATION_TYPE_META } from '@/lib/notifications/labels'
import { categorizeNotificationType } from '@/lib/notifications/digest'

describe('配信ポリシー(delivery)', () => {
  it('画面に名前がある通知は、すべて配信ポリシーを持つ', () => {
    const missing = Object.keys(NOTIFICATION_TYPE_META).filter(
      (type) => !ALL_NOTIFICATION_TYPES.includes(type)
    )
    expect(missing).toEqual([])
  })

  it('知らない種類は鳴らさない・送らない(安全側)', () => {
    expect(getDeliveryPolicy('brand_new_type_we_have_never_seen')).toEqual({
      push: 'none',
      email: 'none',
    })
  })

  it('相手を待たせている種類は、その場で鳴らす', () => {
    for (const type of [
      'review_request',
      'spec_decision_needed',
      'confirmation_request',
      'urgent_confirmation',
      'ball_passed',
      'client_question',
      'client_feedback',
      // 招待の承諾: 招待した人が待っているので、まとめではなくその場で知らせる
      'invite_accepted',
    ]) {
      expect(getDeliveryPolicy(type).push, type).toBe('immediate')
      expect(getDeliveryPolicy(type).email, type).toBe('immediate')
    }
  })

  it('知らせるだけの種類は鳴らさない(まとめに回す)', () => {
    for (const type of [
      'task_completed',
      'file_uploaded',
      'meeting_scheduled',
      'meeting_ended',
      'scheduling_reminder',
      'scheduling_proposal_expired',
      'review_cancelled',
      'digest_approval_request',
    ]) {
      expect(getDeliveryPolicy(type).push, type).toBe('none')
      expect(getDeliveryPolicy(type).email, type).toBe('digest')
    }
  })

  it('割り当て・期限は鳴らすが、メールはまとめに回す', () => {
    for (const type of ['task_assigned', 'due_date_reminder', 'mention']) {
      expect(getDeliveryPolicy(type).push, type).toBe('immediate')
      expect(getDeliveryPolicy(type).email, type).toBe('digest')
    }
  })

  it('専用のメールが別にある運営向けの種類は、まとめに入れない(二重送信を避ける)', () => {
    for (const type of [
      'pool_ai_exhausted',
      'free_cap_upgrade',
      'group_claim_linked',
      'sink_disabled_relink',
    ]) {
      expect(getDeliveryPolicy(type).email, type).toBe('none')
    }
  })

  it('まとめに載せる種類は、まとめの見出し(カテゴリ)を必ず持つ', () => {
    // 見出しが無いとダイジェストから黙って抜け落ちる。即時メール(immediate)は
    // 見出しではなく種類名で件名を作るので、この検査の対象外。
    const orphans = ALL_NOTIFICATION_TYPES.filter(
      (type) => getDeliveryPolicy(type).email === 'digest' && categorizeNotificationType(type) === null
    )
    expect(orphans).toEqual([])
  })
})

describe('静かな時間帯', () => {
  // jstNow() と同じく「ローカル getter が JST を返す Date」を組み立てる
  const at = (y: number, m: number, d: number, h: number) => new Date(y, m - 1, d, h, 0, 0)

  it('平日の夜21時以降と朝8時前は鳴らさない', () => {
    expect(isQuietHours(at(2026, 9, 9, 21))).toBe(true) // 水 21:00
    expect(isQuietHours(at(2026, 9, 9, 23))).toBe(true)
    expect(isQuietHours(at(2026, 9, 10, 2))).toBe(true)
    expect(isQuietHours(at(2026, 9, 10, 7))).toBe(true)
  })

  it('平日の日中は鳴らす', () => {
    expect(isQuietHours(at(2026, 9, 9, 8))).toBe(false)
    expect(isQuietHours(at(2026, 9, 9, 12))).toBe(false)
    expect(isQuietHours(at(2026, 9, 9, 20))).toBe(false)
  })

  it('土日は終日鳴らさない', () => {
    expect(isQuietHours(at(2026, 9, 12, 12))).toBe(true) // 土
    expect(isQuietHours(at(2026, 9, 13, 12))).toBe(true) // 日
  })
})

describe('プッシュを送るかの判定', () => {
  const weekdayNoon = new Date(2026, 8, 9, 12, 0, 0)
  const weekdayNight = new Date(2026, 8, 9, 23, 0, 0)

  it('鳴らす種類・日中・上限内なら送る', () => {
    expect(
      shouldSendPush({ type: 'review_request', jstDate: weekdayNoon, immediateCountToday: 0 })
    ).toBe(true)
  })

  it('知らせるだけの種類は送らない', () => {
    expect(
      shouldSendPush({ type: 'task_completed', jstDate: weekdayNoon, immediateCountToday: 0 })
    ).toBe(false)
  })

  it('夜間・休日は送らない', () => {
    expect(
      shouldSendPush({ type: 'review_request', jstDate: weekdayNight, immediateCountToday: 0 })
    ).toBe(false)
  })

  it('至急の確認だけは夜間でも送る', () => {
    expect(QUIET_HOURS_EXEMPT_TYPES).toContain('urgent_confirmation')
    expect(
      shouldSendPush({ type: 'urgent_confirmation', jstDate: weekdayNight, immediateCountToday: 0 })
    ).toBe(true)
  })

  it('1日の上限を超えたら送らない(荒れた日に静かになる)', () => {
    expect(
      shouldSendPush({
        type: 'review_request',
        jstDate: weekdayNoon,
        immediateCountToday: PUSH_DAILY_CAP - 1,
      })
    ).toBe(true)
    expect(
      shouldSendPush({
        type: 'review_request',
        jstDate: weekdayNoon,
        immediateCountToday: PUSH_DAILY_CAP,
      })
    ).toBe(false)
  })

  it('上限を超えても、至急の確認は送る', () => {
    expect(
      shouldSendPush({
        type: 'urgent_confirmation',
        jstDate: weekdayNoon,
        immediateCountToday: PUSH_DAILY_CAP + 50,
      })
    ).toBe(true)
  })
})

describe('鳴らさなかった理由', () => {
  const weekdayNoon = new Date(2026, 8, 9, 12, 0, 0)
  const weekdayNight = new Date(2026, 8, 9, 23, 0, 0)

  it('理由を区別して返す', () => {
    expect(pushSkipReason({ type: 'task_completed', jstDate: weekdayNoon, immediateCountToday: 0 })).toBe('policy')
    expect(pushSkipReason({ type: 'review_request', jstDate: weekdayNight, immediateCountToday: 0 })).toBe('quiet_hours')
    expect(pushSkipReason({ type: 'review_request', jstDate: weekdayNoon, immediateCountToday: PUSH_DAILY_CAP })).toBe('daily_cap')
    expect(pushSkipReason({ type: 'review_request', jstDate: weekdayNoon, immediateCountToday: 0 })).toBeNull()
  })

  it('件数を数える前に分かる理由は、数えずに判定できる', () => {
    expect(pushSkipReasonWithoutCount({ type: 'task_completed', jstDate: weekdayNoon })).toBe('policy')
    expect(pushSkipReasonWithoutCount({ type: 'review_request', jstDate: weekdayNight })).toBe('quiet_hours')
    expect(pushSkipReasonWithoutCount({ type: 'urgent_confirmation', jstDate: weekdayNight })).toBeNull()
    expect(pushSkipReasonWithoutCount({ type: 'review_request', jstDate: weekdayNoon })).toBeNull()
  })
})

describe('即時メールの対象', () => {
  it('相手を待たせる種類だけが対象', () => {
    expect([...EMAIL_IMMEDIATE_TYPES].sort()).toEqual(
      [
        'ball_passed',
        'client_feedback',
        'client_question',
        'client_replied',
        'client_response',
        'confirmation_request',
        'invite_accepted',
        'review_request',
        'sink_error',
        'spec_decision_needed',
        'urgent_confirmation',
      ].sort()
    )
  })

  it('まとめに回す種類は含まれない', () => {
    for (const type of ['task_assigned', 'task_completed', 'file_uploaded', 'due_date_reminder']) {
      expect(EMAIL_IMMEDIATE_TYPES, type).not.toContain(type)
    }
  })
})
