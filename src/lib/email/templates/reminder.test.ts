import { describe, it, expect } from 'vitest'
import { buildEmailCopy } from './core'
import { REMINDER_TEMPLATE_DEFAULTS, reminderKeyFor, reminderVarsByName } from './reminder'

describe('reminder template', () => {
  it('期限超過の有無でキーが変わる', () => {
    expect(reminderKeyFor(0)).toBe('reminder_client')
    expect(reminderKeyFor(2)).toBe('reminder_client_overdue')
  })

  it('既定文面: 件名に件数、超過ありなら超過件数も入る', () => {
    const vars = reminderVarsByName({ displayName: '太郎', totalCount: 3, overdueCount: 1, dueTodayCount: 1, appName: 'AgentPM' })
    const plain = buildEmailCopy(REMINDER_TEMPLATE_DEFAULTS.reminder_client, vars)
    expect(plain.subject).toBe('【AgentPM】ご対応待ちのタスクが3件あります')
    expect(plain.heading).toBe('ご対応待ちのタスクが3件あります')
    expect(plain.ctaLabel).toBe('タスクを確認')
    const overdue = buildEmailCopy(REMINDER_TEMPLATE_DEFAULTS.reminder_client_overdue, vars)
    expect(overdue.subject).toBe('【AgentPM】ご対応待ちのタスクが3件あります（期限超過1件）')
  })

  it('数値の差し込み値は文字列になり、宛名が無ければ空', () => {
    const vars = reminderVarsByName({ displayName: '', totalCount: 0, overdueCount: 0, dueTodayCount: 0, appName: 'X' })
    expect(vars['件数']).toBe('0')
    expect(vars['宛名']).toBe('')
  })
})
