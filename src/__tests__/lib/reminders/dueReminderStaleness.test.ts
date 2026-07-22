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

  it('タスクの所属コンテナが欠落台帳に載っていれば、SLA内でも false（コンテナ単位の抑止）', () => {
    const lastImportSuccessAt = new Date(now.getTime() - 10 * 60 * 1000).toISOString()
    const info = {
      status: 'active',
      provider: 'google_tasks',
      lastImportSuccessAt,
      importMissingContainers: { 'list-gone': '2026-07-10' },
    }
    expect(isConnectionFresh(info, now, 'list-gone')).toBe(false)
  })

  it('欠落台帳に載っていないコンテナ由来なら、SLA内は従来どおり true（巻き込まない）', () => {
    const lastImportSuccessAt = new Date(now.getTime() - 10 * 60 * 1000).toISOString()
    const info = {
      status: 'active',
      provider: 'google_tasks',
      lastImportSuccessAt,
      importMissingContainers: { 'list-gone': '2026-07-10' },
    }
    expect(isConnectionFresh(info, now, 'list-alive')).toBe(true)
  })

  it('欠落台帳が空なら、externalListIdを渡しても従来どおり true（回帰なし）', () => {
    const lastImportSuccessAt = new Date(now.getTime() - 10 * 60 * 1000).toISOString()
    const info = {
      status: 'active',
      provider: 'google_tasks',
      lastImportSuccessAt,
      importMissingContainers: {},
    }
    expect(isConnectionFresh(info, now, 'list-any')).toBe(true)
  })

  it('externalListIdが無い(undefined)場合は台帳を見ずに従来どおり判定する（フォールバック）', () => {
    const lastImportSuccessAt = new Date(now.getTime() - 10 * 60 * 1000).toISOString()
    const info = {
      status: 'active',
      provider: 'google_tasks',
      lastImportSuccessAt,
      importMissingContainers: { 'list-gone': '2026-07-10' },
    }
    expect(isConnectionFresh(info, now)).toBe(true)
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

  describe('欠落コンテナ由来タスクへの誤催促抑止（台帳とexternal_list_idの突き合わせ）', () => {
    it('欠落台帳に載っているコンテナ由来のタスクは、last_import_success_atがSLA内でも催促されない（本丸）', () => {
      const connectionInfo = {
        ...freshConnection,
        importMissingContainers: { 'list-gone': '2026-07-10' },
      }
      const result = checkDueReminderStaleness(
        {
          status: 'todo',
          dueDate: '2026-07-25',
          dueAuthorityConnectionId: 'conn-1',
          externalListId: 'list-gone',
        },
        '2026-07-25',
        connectionInfo,
        now,
      )
      expect(result).toEqual({ ok: false, reason: 'stale_external_due' })
    })

    it('同じ接続でも、台帳に載っていないコンテナ由来のタスクは従来どおり催促される（巻き込み事故を起こさない）', () => {
      const connectionInfo = {
        ...freshConnection,
        importMissingContainers: { 'list-gone': '2026-07-10' },
      }
      const result = checkDueReminderStaleness(
        {
          status: 'todo',
          dueDate: '2026-07-25',
          dueAuthorityConnectionId: 'conn-1',
          externalListId: 'list-alive',
        },
        '2026-07-25',
        connectionInfo,
        now,
      )
      expect(result).toEqual({ ok: true })
    })

    it('台帳が空({})なら全タスクが従来どおり催促される（回帰なし）', () => {
      const connectionInfo = { ...freshConnection, importMissingContainers: {} }
      const result = checkDueReminderStaleness(
        {
          status: 'todo',
          dueDate: '2026-07-25',
          dueAuthorityConnectionId: 'conn-1',
          externalListId: 'list-any',
        },
        '2026-07-25',
        connectionInfo,
        now,
      )
      expect(result).toEqual({ ok: true })
    })

    it('external_list_idが無いタスク(リンク無し・他コネクタ由来)は従来どおりの判定にフォールバックする', () => {
      const connectionInfo = {
        ...freshConnection,
        importMissingContainers: { 'list-gone': '2026-07-10' },
      }
      const result = checkDueReminderStaleness(
        { status: 'todo', dueDate: '2026-07-25', dueAuthorityConnectionId: 'conn-1' },
        '2026-07-25',
        connectionInfo,
        now,
      )
      expect(result).toEqual({ ok: true })
    })
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
