import { describe, it, expect } from 'vitest'
import { buildDueReminderText, buildDueDigestSectionText } from '@/lib/reminders/dueReminderMessages'

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
