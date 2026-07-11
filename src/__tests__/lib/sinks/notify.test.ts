import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * sink自動停止時の内部向け通知（consecutive_failures>20でstatus='error'。§2-2）。
 * notifications表はspace_id必須のため、org内の代表space（作成が最も古いもの）に紐付ける。
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chain(response: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {}
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'insert', 'upsert']) {
    builder[m] = vi.fn(() => builder)
  }
  builder.maybeSingle = vi.fn(() => Promise.resolve(response))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  builder.then = (resolve: any, reject?: any) => Promise.resolve(response).then(resolve, reject)
  return builder
}

let fromResponses: Record<string, unknown>
const fromMock = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ from: fromMock })),
}))

const { notifySinkBecameError } = await import('@/lib/sinks/notify')

const ORG_ID = 'org-1'
const SINK_ID = 'sink-1'

beforeEach(() => {
  vi.clearAllMocks()
  fromResponses = {
    integration_sinks: { data: { display_name: 'My Webhook' }, error: null },
    spaces: { data: { id: 'space-1' }, error: null },
    org_memberships: { data: [{ user_id: 'owner-1' }, { user_id: 'admin-1' }], error: null },
    notifications: { data: null, error: null },
  }
  fromMock.mockImplementation((table: string) => chain(fromResponses[table]))
})

describe('notifySinkBecameError', () => {
  it('inserts one in_app notification per owner/admin, scoped to a representative space', async () => {
    await notifySinkBecameError(SINK_ID, ORG_ID)

    const notificationsCall = fromMock.mock.calls.find(([table]) => table === 'notifications')
    expect(notificationsCall).toBeDefined()
    const builder = fromMock.mock.results[fromMock.mock.calls.indexOf(notificationsCall!)].value
    const rows = builder.upsert.mock.calls[0][0] as Array<Record<string, unknown>>

    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.to_user_id).sort()).toEqual(['admin-1', 'owner-1'])
    for (const row of rows) {
      expect(row.space_id).toBe('space-1')
      expect(row.org_id).toBe(ORG_ID)
      expect(row.channel).toBe('in_app')
      expect(row.type).toBe('sink_error')
      expect((row.payload as { message: string }).message).toContain('My Webhook')
    }
  })

  it('does nothing (no throw) when the org has no space to attach to', async () => {
    fromResponses.spaces = { data: null, error: null }
    await expect(notifySinkBecameError(SINK_ID, ORG_ID)).resolves.toBeUndefined()
    const notificationsCall = fromMock.mock.calls.find(([table]) => table === 'notifications')
    expect(notificationsCall).toBeUndefined()
  })

  it('does nothing when there are no owner/admin recipients', async () => {
    fromResponses.org_memberships = { data: [], error: null }
    await notifySinkBecameError(SINK_ID, ORG_ID)
    const notificationsCall = fromMock.mock.calls.find(([table]) => table === 'notifications')
    expect(notificationsCall).toBeUndefined()
  })

  it('swallows insert errors (best-effort; never throws)', async () => {
    fromResponses.notifications = { data: null, error: { message: 'conflict' } }
    await expect(notifySinkBecameError(SINK_ID, ORG_ID)).resolves.toBeUndefined()
  })

  // m2回帰テスト: 同日中に再エラー(再有効化→再エラー)が起きると、同じdedupe_keyでの
  // 素の.insert()はunique(to_user_id,channel,dedupe_key)違反でバッチ全体が失敗し、
  // 一部の担当者だけでなく通知が0件になる。upsert+ignoreDuplicatesで
  // 「既存の同キー通知はスキップ・新規担当者へは届く」を保証する。
  it('uses upsert with onConflict + ignoreDuplicates instead of a plain insert (avoids the whole batch failing on a same-day dedupe_key collision)', async () => {
    await notifySinkBecameError(SINK_ID, ORG_ID)

    expect(fromMock.mock.calls.some(([table]) => table === 'notifications')).toBe(true)
    const notificationsCall = fromMock.mock.calls.find(([table]) => table === 'notifications')
    const builder = fromMock.mock.results[fromMock.mock.calls.indexOf(notificationsCall!)].value

    expect(builder.insert).not.toHaveBeenCalled()
    expect(builder.upsert).toHaveBeenCalledTimes(1)
    const [rows, options] = builder.upsert.mock.calls[0]
    expect(Array.isArray(rows)).toBe(true)
    expect(options).toEqual({ onConflict: 'to_user_id,channel,dedupe_key', ignoreDuplicates: true })
  })
})
