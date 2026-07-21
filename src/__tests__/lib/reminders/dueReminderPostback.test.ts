import { describe, it, expect } from 'vitest'
import {
  buildDueReminderDonePostbackData,
  parseDueReminderDonePostback,
  buildDueReminderSnoozePostbackData,
  parseDueReminderSnoozePostback,
} from '@/lib/reminders/dueReminderPostback'

/**
 * 期限リマインド確認ループの postback.data 形式（設計正本 §7・PR-2・code review #2是正）:
 *   完了: `action=due_reminder_done&task=<uuid>`
 *   スヌーズ: `action=due_reminder_snooze&occurrence=<uuid>&days=<int>&gen=<send_count>`
 * digest postback と同型（`action=digest_done&task=<uuid>` 等）。
 * `gen`（世代=送信時のoccurrence.send_count）は旧世代Flexのリプレイ防止（RPC側でp_expected_send_count比較）。
 */

const TASK_ID = '11111111-1111-4111-8111-111111111111'
const OCCURRENCE_ID = '22222222-2222-4222-8222-222222222222'

describe('parseDueReminderDonePostback / buildDueReminderDonePostbackData', () => {
  it('builderで組んだdataを往復できる', () => {
    const data = buildDueReminderDonePostbackData(TASK_ID)
    expect(data).toBe(`action=due_reminder_done&task=${TASK_ID}`)
    expect(parseDueReminderDonePostback(data)).toEqual({ taskId: TASK_ID })
  })

  it('actionが異なれば null', () => {
    expect(parseDueReminderDonePostback(`action=digest_done&task=${TASK_ID}`)).toBeNull()
  })

  it('taskがUUIDでなければ null', () => {
    expect(parseDueReminderDonePostback('action=due_reminder_done&task=not-a-uuid')).toBeNull()
  })

  it('task欠落は null', () => {
    expect(parseDueReminderDonePostback('action=due_reminder_done')).toBeNull()
  })

  it('壊れた文字列は例外を投げず null', () => {
    expect(parseDueReminderDonePostback('')).toBeNull()
  })

  it('due_reminder_snooze形式はdoneとして解析しない（判別）', () => {
    expect(
      parseDueReminderDonePostback(
        `action=due_reminder_snooze&occurrence=${OCCURRENCE_ID}&days=1&gen=0`,
      ),
    ).toBeNull()
  })
})

describe('parseDueReminderSnoozePostback / buildDueReminderSnoozePostbackData', () => {
  it('builderで組んだdataを往復できる（世代=gen込み）', () => {
    const data = buildDueReminderSnoozePostbackData(OCCURRENCE_ID, 1, 0)
    expect(data).toBe(`action=due_reminder_snooze&occurrence=${OCCURRENCE_ID}&days=1&gen=0`)
    expect(parseDueReminderSnoozePostback(data)).toEqual({
      occurrenceId: OCCURRENCE_ID,
      days: 1,
      expectedSendCount: 0,
    })
  })

  it('daysが複数桁・genが1以上でも解析できる', () => {
    const data = buildDueReminderSnoozePostbackData(OCCURRENCE_ID, 14, 3)
    expect(parseDueReminderSnoozePostback(data)).toEqual({
      occurrenceId: OCCURRENCE_ID,
      days: 14,
      expectedSendCount: 3,
    })
  })

  it('actionが異なれば null', () => {
    expect(parseDueReminderSnoozePostback(`action=due_reminder_done&task=${TASK_ID}`)).toBeNull()
  })

  it('occurrenceがUUIDでなければ null', () => {
    expect(
      parseDueReminderSnoozePostback('action=due_reminder_snooze&occurrence=not-a-uuid&days=1&gen=0'),
    ).toBeNull()
  })

  it('occurrence欠落は null', () => {
    expect(parseDueReminderSnoozePostback('action=due_reminder_snooze&days=1&gen=0')).toBeNull()
  })

  it('daysが欠落・非数値・0以下・非整数なら null', () => {
    expect(
      parseDueReminderSnoozePostback(`action=due_reminder_snooze&occurrence=${OCCURRENCE_ID}&gen=0`),
    ).toBeNull()
    expect(
      parseDueReminderSnoozePostback(
        `action=due_reminder_snooze&occurrence=${OCCURRENCE_ID}&days=abc&gen=0`,
      ),
    ).toBeNull()
    expect(
      parseDueReminderSnoozePostback(
        `action=due_reminder_snooze&occurrence=${OCCURRENCE_ID}&days=0&gen=0`,
      ),
    ).toBeNull()
    expect(
      parseDueReminderSnoozePostback(
        `action=due_reminder_snooze&occurrence=${OCCURRENCE_ID}&days=-1&gen=0`,
      ),
    ).toBeNull()
    expect(
      parseDueReminderSnoozePostback(
        `action=due_reminder_snooze&occurrence=${OCCURRENCE_ID}&days=1.5&gen=0`,
      ),
    ).toBeNull()
  })

  it('gen(世代)が欠落・非数値・負数・非整数なら null', () => {
    expect(
      parseDueReminderSnoozePostback(`action=due_reminder_snooze&occurrence=${OCCURRENCE_ID}&days=1`),
    ).toBeNull()
    expect(
      parseDueReminderSnoozePostback(
        `action=due_reminder_snooze&occurrence=${OCCURRENCE_ID}&days=1&gen=abc`,
      ),
    ).toBeNull()
    expect(
      parseDueReminderSnoozePostback(
        `action=due_reminder_snooze&occurrence=${OCCURRENCE_ID}&days=1&gen=-1`,
      ),
    ).toBeNull()
    expect(
      parseDueReminderSnoozePostback(
        `action=due_reminder_snooze&occurrence=${OCCURRENCE_ID}&days=1&gen=1.5`,
      ),
    ).toBeNull()
  })

  it('gen=0（初回送信）は有効な値として解析できる', () => {
    expect(
      parseDueReminderSnoozePostback(
        `action=due_reminder_snooze&occurrence=${OCCURRENCE_ID}&days=1&gen=0`,
      ),
    ).toEqual({ occurrenceId: OCCURRENCE_ID, days: 1, expectedSendCount: 0 })
  })

  it('壊れた文字列は例外を投げず null', () => {
    expect(parseDueReminderSnoozePostback('')).toBeNull()
  })

  it('due_reminder_done形式はsnoozeとして解析しない（判別）', () => {
    expect(parseDueReminderSnoozePostback(`action=due_reminder_done&task=${TASK_ID}`)).toBeNull()
  })
})
