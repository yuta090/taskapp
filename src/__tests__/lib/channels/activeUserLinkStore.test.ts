import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * findActiveUserLinkForUser: hasActiveUserLinkForUser の値返し版。期限リマインドの
 * 1:1 DM 宛先解決に使う（設計正本 docs/spec/AI_SECRETARY_STAGE5_DUE_REMINDERS.md §9 §A）。
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chain(response: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {}
  for (const m of ['select', 'eq', 'is', 'limit', 'in']) {
    builder[m] = vi.fn(() => builder)
  }
  builder.maybeSingle = vi.fn(() => Promise.resolve(response))
  // findUserIdsWithActiveLink は .maybeSingle() を呼ばず直接await（thenable）される
  builder.then = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onFulfilled: (value: any) => unknown,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onRejected?: (reason: any) => unknown,
  ) => Promise.resolve(response).then(onFulfilled, onRejected)
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
  // A案是正: dm_unreachable_at はこの関数の関心事から外した（旧M-4対応を撤回）。
  // sender側はもはやdm_unreachable_atを読みも書きもしない（clearDmUnreachable呼び出し自体を
  // 廃止したため、追加往復回避のための値保持が不要になった）。

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

  it('org_id/user_id/revoked_at is null で絞り込む（dm_unreachable_atは選択しない）', async () => {
    fromResponse = { data: null, error: null }
    fromMock.mockImplementation(() => chain(fromResponse))
    await store.findActiveUserLinkForUser('org-1', 'user-1')

    expect(fromMock).toHaveBeenCalledWith('channel_user_links')
    const call = fromMock.mock.results[0].value
    expect(call.select).toHaveBeenCalledWith(expect.not.stringContaining('dm_unreachable_at'))
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

describe('findUserIdsWithActiveLink（batch版・digest安全網のper-task DM判定用）', () => {
  it('空配列ならクエリせず空Setを返す', async () => {
    const result = await store.findUserIdsWithActiveLink('org-1', [])
    expect(result.size).toBe(0)
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('重複user_idは1回にまとめてinで問い合わせる', async () => {
    fromResponse = { data: [], error: null }
    fromMock.mockImplementation(() => chain(fromResponse))
    await store.findUserIdsWithActiveLink('org-1', ['u-1', 'u-1', 'u-2'])

    expect(fromMock).toHaveBeenCalledWith('channel_user_links')
    const call = fromMock.mock.results[0].value
    expect(call.eq).toHaveBeenCalledWith('org_id', 'org-1')
    expect(call.in).toHaveBeenCalledWith('user_id', ['u-1', 'u-2'])
    expect(call.is).toHaveBeenCalledWith('revoked_at', null)
  })

  it('MEDIUM-1是正: 紐付け先accountがactiveであることも条件に含める（sender側resolveDmCandidateとの対称化）', async () => {
    fromResponse = { data: [], error: null }
    fromMock.mockImplementation(() => chain(fromResponse))
    await store.findUserIdsWithActiveLink('org-1', ['u-1'])

    const call = fromMock.mock.results[0].value
    expect(call.select).toHaveBeenCalledWith(expect.stringContaining('channel_accounts!inner(status)'))
    expect(call.eq).toHaveBeenCalledWith('channel_accounts.status', 'active')
  })

  it('安全網の穴是正: dm_unreachable_atが非NULL(恒久失敗マーク済み)のlinkは除外条件に含める', async () => {
    fromResponse = { data: [], error: null }
    fromMock.mockImplementation(() => chain(fromResponse))
    await store.findUserIdsWithActiveLink('org-1', ['u-1'])

    const call = fromMock.mock.results[0].value
    expect(call.is).toHaveBeenCalledWith('dm_unreachable_at', null)
  })

  it('dm_unreachable_atが立っているuser_idはDBが返さない前提なので、結果setに含まれない', async () => {
    // dm_unreachable_at is null 条件はDB側のクエリで絞り込まれる。ここではその絞り込み後の
    // 結果（到達不能な担当者は行ごと返らない）をstoreがそのままSetにする挙動を確認する。
    fromResponse = { data: [{ user_id: 'u-reachable' }], error: null }
    fromMock.mockImplementation(() => chain(fromResponse))
    const result = await store.findUserIdsWithActiveLink('org-1', ['u-reachable', 'u-unreachable'])
    expect(result.has('u-reachable')).toBe(true)
    expect(result.has('u-unreachable')).toBe(false)
  })

  it('active linkのあるuser_idの集合を返す', async () => {
    fromResponse = { data: [{ user_id: 'u-1' }], error: null }
    fromMock.mockImplementation(() => chain(fromResponse))
    const result = await store.findUserIdsWithActiveLink('org-1', ['u-1', 'u-2'])
    expect(result.has('u-1')).toBe(true)
    expect(result.has('u-2')).toBe(false)
  })

  it('DBエラーはthrowする', async () => {
    fromResponse = { data: null, error: { message: 'boom' } }
    fromMock.mockImplementation(() => chain(fromResponse))
    await expect(store.findUserIdsWithActiveLink('org-1', ['u-1'])).rejects.toThrow(
      /batch active link lookup failed/,
    )
  })
})
