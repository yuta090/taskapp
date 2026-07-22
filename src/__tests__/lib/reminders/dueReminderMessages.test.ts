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
 * 期限リマインドの文面（設計正本 §9・うざくない秘書 再設計）。
 *
 * 私信(DM)=“問い”に統一した後の buildDueReminderText/buildDueReminderFlex は
 * ball(client/internal)で文面を出し分けない（宛先はどちらのballでも内側担当者のDM共通）。
 * 「N回目の再通知」表示も廃止した。
 */

describe('buildDueReminderText', () => {
  it('due_soon: 「明日期限」の丁寧な問いになる', () => {
    expect(buildDueReminderText({ kind: 'due_soon', title: '見積書の送付' })).toBe(
      [
        '「見積書の送付」が明日期限です。',
        '・完了済みでしたら、下の[完了した]を押してください。',
        '・まだの場合は、ご対応をお願いします。',
      ].join('\n'),
    )
  })

  it('due_today: 「今日期限」の丁寧な問いになる', () => {
    expect(buildDueReminderText({ kind: 'due_today', title: '見積書の送付' })).toBe(
      [
        '「見積書の送付」が今日期限です。',
        '・完了済みでしたら、下の[完了した]を押してください。',
        '・まだの場合は、ご対応をお願いします。',
      ].join('\n'),
    )
  })

  it('overdue_confirm: 「期限が過ぎています」の丁寧な問いになる', () => {
    expect(buildDueReminderText({ kind: 'overdue_confirm', title: '見積書の送付' })).toBe(
      [
        '「見積書の送付」の期限が過ぎています。',
        '・完了済みでしたら、下の[完了した]を押してください。',
        '・まだの場合は、ご対応をお願いします。',
      ].join('\n'),
    )
  })

  it('催促・命令調（「〜をお願いします」相手先向け等）の文言は含まない', () => {
    const text = buildDueReminderText({ kind: 'overdue_confirm', title: 'X' })
    expect(text).not.toContain('催促')
    expect(text).not.toContain('相手先')
  })

  it('「N回目の再通知」表示は無い（うざくない秘書 再設計で廃止）', () => {
    const text = buildDueReminderText({ kind: 'due_today', title: 'X' })
    expect(text).not.toContain('回目')
  })

  it('kindが同じならタイトル以外は常に同一文面（ball非依存）', () => {
    const first = buildDueReminderText({ kind: 'due_today', title: 'X' })
    const second = buildDueReminderText({ kind: 'due_today', title: 'X' })
    expect(first).toBe(second)
  })
})

describe('buildDueReminderFlex', () => {
  const TASK_ID = '11111111-1111-4111-8111-111111111111'
  const OCCURRENCE_ID = '22222222-2222-4222-8222-222222222222'

  it('altTextはbuildDueReminderTextと同じ本文になる', () => {
    const flex = buildDueReminderFlex({
      kind: 'due_today',
      title: '見積書の送付',
      taskId: TASK_ID,
      occurrenceId: OCCURRENCE_ID,
    })
    expect(flex.type).toBe('flex')
    expect(flex.altText).toBe(buildDueReminderText({ kind: 'due_today', title: '見積書の送付' }))
    // 本文もbody内に同じテキストが入る
    expect(flex.contents.body.contents[0].text).toBe(flex.altText)
  })

  it('[完了した]ボタンはdue_reminder_done postbackでtaskIdを載せる', () => {
    const flex = buildDueReminderFlex({
      kind: 'due_soon',
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

  it('[対応中]と[明日また確認]は同一のsnooze postback（既定SNOOZE_DAYS日・世代gen=0既定）を持つ（統合）', () => {
    const flex = buildDueReminderFlex({
      kind: 'overdue_confirm',
      title: 'X',
      taskId: TASK_ID,
      occurrenceId: OCCURRENCE_ID,
    })
    const buttons = flex.contents.footer.contents as Array<{
      type: string
      action: { label: string; data: string; displayText: string }
    }>
    const [, inProgressButton, tomorrowButton] = buttons
    expect(inProgressButton.action.label).toBe('対応中')
    expect(tomorrowButton.action.label).toBe('明日また確認')
    expect(inProgressButton.action.data).toBe(tomorrowButton.action.data)
    expect(parseDueReminderSnoozePostback(inProgressButton.action.data)).toEqual({
      occurrenceId: OCCURRENCE_ID,
      days: SNOOZE_DAYS,
      expectedSendCount: 0,
    })
  })

  it('snoozeCount(=occurrence.send_count)がsnooze postbackのgen(世代)に焼き込まれる（code review #2是正）', () => {
    const flex = buildDueReminderFlex({
      kind: 'overdue_confirm',
      title: 'X',
      taskId: TASK_ID,
      occurrenceId: OCCURRENCE_ID,
      snoozeCount: 2,
    })
    const buttons = flex.contents.footer.contents as Array<{
      type: string
      action: { label: string; data: string; displayText: string }
    }>
    const [, inProgressButton] = buttons
    expect(parseDueReminderSnoozePostback(inProgressButton.action.data)).toEqual({
      occurrenceId: OCCURRENCE_ID,
      days: SNOOZE_DAYS,
      expectedSendCount: 2,
    })
  })

  it('snoozeCountを渡してもaltText/本文に再通知回数は出さない（うざくない秘書 再設計）', () => {
    const flex = buildDueReminderFlex({
      kind: 'overdue_confirm',
      title: 'X',
      taskId: TASK_ID,
      occurrenceId: OCCURRENCE_ID,
      snoozeCount: 2,
    })
    expect(flex.altText).not.toContain('回目')
  })
})

describe('buildDueDigestSectionText（中立文面・安全網v2）', () => {
  const TODAY_JST = '2026-07-21'

  it('対象0件なら空文字（呼び出し側で空欄を作らない）', () => {
    expect(buildDueDigestSectionText([], TODAY_JST)).toBe('')
  })

  it('本日が期限と期限超過をヘッダ分けして積む（中立文面・催促/ball文言なし）', () => {
    const text = buildDueDigestSectionText(
      [
        { kind: 'due_today', title: 'タスクA' },
        { kind: 'overdue_confirm', title: 'タスクB' },
      ],
      TODAY_JST,
    )
    expect(text).toContain(`【期限のお知らせ】${TODAY_JST}`)
    expect(text).toContain('完了済みのものは各タスクで「完了」に、未対応のものはご対応をお願いします。')
    expect(text).toContain('■ 本日が期限')
    expect(text).toContain('・タスクA')
    expect(text).toContain('■ 期限超過')
    expect(text).toContain('・タスクB')
    expect(text).not.toContain('催促')
    expect(text).not.toContain('相手先')
  })

  it('本日が期限のみなら期限超過ヘッダは出さない', () => {
    const text = buildDueDigestSectionText([{ kind: 'due_today', title: 'タスクA' }], TODAY_JST)
    expect(text).toContain('■ 本日が期限')
    expect(text).not.toContain('■ 期限超過')
  })

  it('期限超過のみなら本日が期限ヘッダは出さない', () => {
    const text = buildDueDigestSectionText([{ kind: 'overdue_confirm', title: 'タスクB' }], TODAY_JST)
    expect(text).not.toContain('■ 本日が期限')
    expect(text).toContain('■ 期限超過')
  })

  describe('perf是正: 見出しあたり上位10件＋「ほかN件」に丸める', () => {
    it('11件あれば10件だけ列挙し「・ほか1件」を追記する', () => {
      const items = Array.from({ length: 11 }, (_, i) => ({
        kind: 'due_today' as const,
        title: `タスク${i + 1}`,
      }))
      const text = buildDueDigestSectionText(items, TODAY_JST)

      expect(text).toContain('・タスク1')
      expect(text).toContain('・タスク10')
      expect(text).not.toContain('・タスク11')
      expect(text).toContain('・ほか1件')
    })

    it('本日が期限/期限超過それぞれ独立に上限を適用する', () => {
      const today = Array.from({ length: 12 }, (_, i) => ({
        kind: 'due_today' as const,
        title: `本日${i + 1}`,
      }))
      const overdue = Array.from({ length: 3 }, (_, i) => ({
        kind: 'overdue_confirm' as const,
        title: `超過${i + 1}`,
      }))
      const text = buildDueDigestSectionText([...today, ...overdue], TODAY_JST)

      expect(text).toContain('・ほか2件')
      expect(text).toContain('・超過1')
      expect(text).toContain('・超過3')
      expect(text).not.toContain('・ほか3件')
    })

    it('10件ちょうどなら「ほか」行は出さない', () => {
      const items = Array.from({ length: 10 }, (_, i) => ({
        kind: 'due_today' as const,
        title: `タスク${i + 1}`,
      }))
      const text = buildDueDigestSectionText(items, TODAY_JST)
      expect(text).not.toContain('ほか')
    })
  })
})
