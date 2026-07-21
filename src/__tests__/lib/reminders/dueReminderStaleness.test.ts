import { describe, it, expect } from 'vitest'
import {
  isConnectionFresh,
  checkDueReminderStaleness,
  classifyDueForDigest,
} from '@/lib/reminders/dueReminderStaleness'

/**
 * Staleness ガード（設計正本 §6・クラックスC「不確かなら送らない」）。
 */

describe('isConnectionFresh', () => {
  const now = new Date('2026-07-20T10:00:00.000Z')

  it('接続情報が無ければ false（証明不能）', () => {
    expect(isConnectionFresh(null, now)).toBe(false)
  })

  it('status active でなければ false', () => {
    expect(
      isConnectionFresh(
        { status: 'expired', provider: 'google_tasks', lastImportSuccessAt: now.toISOString() },
        now,
      ),
    ).toBe(false)
  })

  it('last_import_success_at が無ければ false（一度も全ページ成功していない）', () => {
    expect(
      isConnectionFresh({ status: 'active', provider: 'google_tasks', lastImportSuccessAt: null }, now),
    ).toBe(false)
  })

  it('poll-sla方式でSLA(30分)以内なら true', () => {
    const lastImportSuccessAt = new Date(now.getTime() - 10 * 60 * 1000).toISOString()
    expect(isConnectionFresh({ status: 'active', provider: 'google_tasks', lastImportSuccessAt }, now)).toBe(
      true,
    )
  })

  it('SLA(30分)を超えたら false', () => {
    const lastImportSuccessAt = new Date(now.getTime() - 31 * 60 * 1000).toISOString()
    expect(isConnectionFresh({ status: 'active', provider: 'google_tasks', lastImportSuccessAt }, now)).toBe(
      false,
    )
  })

  it('dueFreshness=noneのprovider(multica)は鮮度証明ができず false（fail-quiet）', () => {
    const lastImportSuccessAt = now.toISOString()
    expect(isConnectionFresh({ status: 'active', provider: 'multica', lastImportSuccessAt }, now)).toBe(false)
  })
})

describe('checkDueReminderStaleness', () => {
  const now = new Date('2026-07-20T10:00:00.000Z')
  const freshConnection = {
    status: 'active',
    provider: 'google_tasks',
    lastImportSuccessAt: now.toISOString(),
  }

  it('status=doneはsuppressed(done)', () => {
    const result = checkDueReminderStaleness(
      { status: 'done', dueDate: '2026-07-25', dueAuthorityConnectionId: null },
      '2026-07-25',
      null,
      now,
    )
    expect(result).toEqual({ ok: false, reason: 'done' })
  })

  it('再読取りのdue_dateがdue_snapshotと不一致はsuppressed(due_changed)', () => {
    const result = checkDueReminderStaleness(
      { status: 'todo', dueDate: '2026-07-26', dueAuthorityConnectionId: null },
      '2026-07-25',
      null,
      now,
    )
    expect(result).toEqual({ ok: false, reason: 'due_changed' })
  })

  it('external権威で接続が鮮度SLA超過はsuppressed(stale_external_due)', () => {
    const stale = { ...freshConnection, lastImportSuccessAt: new Date(now.getTime() - 60 * 60 * 1000).toISOString() }
    const result = checkDueReminderStaleness(
      { status: 'todo', dueDate: '2026-07-25', dueAuthorityConnectionId: 'conn-1' },
      '2026-07-25',
      stale,
      now,
    )
    expect(result).toEqual({ ok: false, reason: 'stale_external_due' })
  })

  it('internal権威(dueAuthorityConnectionId=null)は接続鮮度を問わずok', () => {
    const result = checkDueReminderStaleness(
      { status: 'todo', dueDate: '2026-07-25', dueAuthorityConnectionId: null },
      '2026-07-25',
      null,
      now,
    )
    expect(result).toEqual({ ok: true })
  })

  it('external権威で接続が鮮度SLA内はok', () => {
    const result = checkDueReminderStaleness(
      { status: 'todo', dueDate: '2026-07-25', dueAuthorityConnectionId: 'conn-1' },
      '2026-07-25',
      freshConnection,
      now,
    )
    expect(result).toEqual({ ok: true })
  })

  it('3条件全て満たせばok（3条件ANDの回帰）', () => {
    const result = checkDueReminderStaleness(
      { status: 'todo', dueDate: '2026-07-25', dueAuthorityConnectionId: null },
      '2026-07-25',
      null,
      now,
    )
    expect(result.ok).toBe(true)
  })
})

describe('classifyDueForDigest', () => {
  it('翌日→due_soon', () => {
    expect(classifyDueForDigest('2026-07-21', '2026-07-20')).toBe('due_soon')
  })
  it('当日→due_today', () => {
    expect(classifyDueForDigest('2026-07-20', '2026-07-20')).toBe('due_today')
  })
  it('超過（過去日）→overdue_confirm', () => {
    expect(classifyDueForDigest('2026-07-18', '2026-07-20')).toBe('overdue_confirm')
  })
  it('2日以上先→null（digestの期限セクション対象外）', () => {
    expect(classifyDueForDigest('2026-07-22', '2026-07-20')).toBeNull()
  })
})
