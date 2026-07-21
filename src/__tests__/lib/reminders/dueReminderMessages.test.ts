import { describe, it, expect } from 'vitest'
import {
  buildDueReminderText,
  buildDueDigestSectionText,
  buildDueReminderFlex,
  SNOOZE_DAYS,
} from '@/lib/reminders/dueReminderMessages'
import {
  parseDueReminderDonePostback,
  parseDueReminderSnoozePostback,
} from '@/lib/reminders/dueReminderPostback'

/**
 * 期限リマインドの文面（設計正本 §9）。kind×ball の6組＋snoozeCount反映。
 */

describe('buildDueReminderText', () => {
  it('client × due_soon: 相手先への催促ナッジ', () => {
    expect(buildDueReminderText({ kind: 'due_soon', ball: 'client', title: '見積書の送付' })).toBe(
      '『見積書の送付』の期限が明日です。相手先への催促はお済みですか？',
    )
  })
  it('client × due_today', () => {
    expect(buildDueReminderText({ kind: 'due_today', ball: 'client', title: '見積書の送付' })).toBe(
      '『見積書の送付』の期限が今日です。相手先への催促はお済みですか？',
    )
  })
  it('client × overdue_confirm', () => {
    expect(buildDueReminderText({ kind: 'overdue_confirm', ball: 'client', title: '見積書の送付' })).toBe(
      '『見積書の送付』の期限が過ぎています。相手先に催促をお願いします。',
    )
  })
  it('internal × due_soon: 対応ナッジ', () => {
    expect(buildDueReminderText({ kind: 'due_soon', ball: 'internal', title: '請求書の確認' })).toBe(
      '『請求書の確認』の期限が明日です。対応をお願いします。',
    )
  })
  it('internal × due_today', () => {
    expect(buildDueReminderText({ kind: 'due_today', ball: 'internal', title: '請求書の確認' })).toBe(
      '『請求書の確認』の期限が今日です。対応をお願いします。',
    )
  })
  it('internal × overdue_confirm', () => {
    expect(buildDueReminderText({ kind: 'overdue_confirm', ball: 'internal', title: '請求書の確認' })).toBe(
      '『請求書の確認』の期限が過ぎています。状況をご確認ください。',
    )
  })

  it('snoozeCountが1以上なら再通知の旨を追記する', () => {
    const text = buildDueReminderText({
      kind: 'overdue_confirm',
      ball: 'internal',
      title: '請求書の確認',
      snoozeCount: 2,
    })
    expect(text).toContain('請求書の確認』の期限が過ぎています。状況をご確認ください。')
    expect(text).toContain('2回目の再通知')
  })

  it('snoozeCountが0/未指定なら追記しない', () => {
    const withZero = buildDueReminderText({
      kind: 'due_today',
      ball: 'internal',
      title: 'X',
      snoozeCount: 0,
    })
    const withoutField = buildDueReminderText({ kind: 'due_today', ball: 'internal', title: 'X' })
    expect(withZero).not.toContain('回目')
    expect(withoutField).not.toContain('回目')
    expect(withZero).toBe(withoutField)
  })

  it('ballが宛先ではなく文面だけを変える（同一kindでballだけ変えるとテキストが変わる）', () => {
    const client = buildDueReminderText({ kind: 'due_today', ball: 'client', title: 'X' })
    const internal = buildDueReminderText({ kind: 'due_today', ball: 'internal', title: 'X' })
    expect(client).not.toBe(internal)
  })
})

describe('buildDueReminderFlex', () => {
  const TASK_ID = '11111111-1111-4111-8111-111111111111'
  const OCCURRENCE_ID = '22222222-2222-4222-8222-222222222222'

  it('altTextはbuildDueReminderTextと同じ本文になる', () => {
    const flex = buildDueReminderFlex({
      kind: 'due_today',
      ball: 'internal',
      title: '見積書の送付',
      taskId: TASK_ID,
      occurrenceId: OCCURRENCE_ID,
    })
    expect(flex.type).toBe('flex')
    expect(flex.altText).toBe(
      buildDueReminderText({ kind: 'due_today', ball: 'internal', title: '見積書の送付' }),
    )
    // 本文もbody内に同じテキストが入る
    expect(flex.contents.body.contents[0].text).toBe(flex.altText)
  })

  it('[完了した]ボタンはdue_reminder_done postbackでtaskIdを載せる', () => {
    const flex = buildDueReminderFlex({
      kind: 'due_soon',
      ball: 'client',
      title: 'X',
      taskId: TASK_ID,
      occurrenceId: OCCURRENCE_ID,
    })
    const buttons = flex.contents.footer.contents as Array<{
      type: string
      action: { label: string; data: string; displayText: string }
    }>
    expect(buttons).toHaveLength(3)
    const doneButton = buttons[0]
    expect(doneButton.action.label).toBe('完了した')
    expect(parseDueReminderDonePostback(doneButton.action.data)).toEqual({ taskId: TASK_ID })
  })

  it('[まだ]と[○日後に再通知]は同一のsnooze postback（既定SNOOZE_DAYS日・世代gen=0既定）を持つ', () => {
    const flex = buildDueReminderFlex({
      kind: 'overdue_confirm',
      ball: 'internal',
      title: 'X',
      taskId: TASK_ID,
      occurrenceId: OCCURRENCE_ID,
    })
    const buttons = flex.contents.footer.contents as Array<{
      type: string
      action: { label: string; data: string; displayText: string }
    }>
    const [, matadaButton, snoozeButton] = buttons
    expect(matadaButton.action.label).toBe('まだ')
    expect(snoozeButton.action.label).toBe(`${SNOOZE_DAYS}日後に再通知`)
    expect(matadaButton.action.data).toBe(snoozeButton.action.data)
    expect(parseDueReminderSnoozePostback(matadaButton.action.data)).toEqual({
      occurrenceId: OCCURRENCE_ID,
      days: SNOOZE_DAYS,
      expectedSendCount: 0,
    })
  })

  it('snoozeCount(=occurrence.send_count)がsnooze postbackのgen(世代)に焼き込まれる（code review #2是正）', () => {
    const flex = buildDueReminderFlex({
      kind: 'overdue_confirm',
      ball: 'internal',
      title: 'X',
      taskId: TASK_ID,
      occurrenceId: OCCURRENCE_ID,
      snoozeCount: 2,
    })
    const buttons = flex.contents.footer.contents as Array<{
      type: string
      action: { label: string; data: string; displayText: string }
    }>
    const [, matadaButton] = buttons
    expect(parseDueReminderSnoozePostback(matadaButton.action.data)).toEqual({
      occurrenceId: OCCURRENCE_ID,
      days: SNOOZE_DAYS,
      expectedSendCount: 2,
    })
  })

  it('snoozeCountを渡すとaltText/本文に再通知回数を反映する', () => {
    const flex = buildDueReminderFlex({
      kind: 'overdue_confirm',
      ball: 'internal',
      title: 'X',
      taskId: TASK_ID,
      occurrenceId: OCCURRENCE_ID,
      snoozeCount: 2,
    })
    expect(flex.altText).toContain('2回目の再通知')
  })
})

describe('buildDueDigestSectionText', () => {
  it('対象0件なら空文字（呼び出し側で空欄を作らない）', () => {
    expect(buildDueDigestSectionText([])).toBe('')
  })

  it('対象があればヘッダ付きで各行を積む', () => {
    const text = buildDueDigestSectionText([
      { kind: 'due_soon', ball: 'internal', title: 'タスクA' },
      { kind: 'overdue_confirm', ball: 'client', title: 'タスクB' },
    ])
    expect(text).toContain('⏰期限のお知らせ')
    expect(text).toContain('『タスクA』の期限が明日です。対応をお願いします。')
    expect(text).toContain('『タスクB』の期限が過ぎています。相手先に催促をお願いします。')
  })
})
