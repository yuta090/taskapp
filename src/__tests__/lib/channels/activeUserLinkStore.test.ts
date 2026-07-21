import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * findActiveUserLinkForUser: hasActiveUserLinkForUser の値返し版。期限リマインドの
 * 1:1 DM 宛先解決に使う（設計正本 docs/spec/AI_SECRETARY_STAGE5_DUE_REMINDERS.md §9 §A）。
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chain(response: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {}
  for (const m of ['select', 'eq', 'is', 'limit']) {
    builder[m] = vi.fn(() => builder)
  }
  builder.maybeSingle = vi.fn(() => Promise.resolve(response))
  return builder
}

let fromResponse: unknown
const fromMock = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ from: fromMock })),
}))

const store = await import('@/lib/channels/store')

beforeEach(() => {
  vi.clearAllMocks()
  fromResponse = { data: null, error: null }
  fromMock.mockImplementation(() => chain(fromResponse))
})

describe('findActiveUserLinkForUser', () => {
  it('active な紐付けがあれば {channelAccountId, externalUserId} を返す', async () => {
    fromResponse = { data: { channel_account_id: 'acc-1', external_user_id: 'U-1' }, error: null }
    fromMock.mockImplementation(() => chain(fromResponse))
    const r = await store.findActiveUserLinkForUser('org-1', 'user-1')
    expect(r).toEqual({ channelAccountId: 'acc-1', externalUserId: 'U-1' })
  })

  it('該当なしはnull', async () => {
    fromResponse = { data: null, error: null }
    fromMock.mockImplementation(() => chain(fromResponse))
    expect(await store.findActiveUserLinkForUser('org-1', 'user-x')).toBeNull()
  })

  it('org_id/user_id/revoked_at is null で絞り込む', async () => {
    fromResponse = { data: null, error: null }
    fromMock.mockImplementation(() => chain(fromResponse))
    await store.findActiveUserLinkForUser('org-1', 'user-1')

    expect(fromMock).toHaveBeenCalledWith('channel_user_links')
    const call = fromMock.mock.results[0].value
    expect(call.eq).toHaveBeenCalledWith('org_id', 'org-1')
    expect(call.eq).toHaveBeenCalledWith('user_id', 'user-1')
    expect(call.is).toHaveBeenCalledWith('revoked_at', null)
  })

  it('DBエラーはthrowする', async () => {
    fromResponse = { data: null, error: { message: 'boom' } }
    fromMock.mockImplementation(() => chain(fromResponse))
    await expect(store.findActiveUserLinkForUser('org-1', 'user-1')).rejects.toThrow(
      /active link lookup failed/,
    )
  })
})
