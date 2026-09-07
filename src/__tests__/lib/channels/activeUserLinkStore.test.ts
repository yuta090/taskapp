import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * findActiveUserLinkForUser: hasActiveUserLinkForUser の値返し版。期限リマインドの
 * 1:1 DM 宛先解決に使う（設計正本 docs/spec/AI_SECRETARY_STAGE5_DUE_REMINDERS.md §9 §A）。
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chain(response: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {}
  for (const m of ['select', 'eq', 'is', 'limit', 'in', 'order']) {
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

describe('pickPreferredUserLink（複数チャネルにつないだ人の宛先の選び方・正本）', () => {
  const base = { externalUserId: 'x', linkedAt: '2026-09-01T00:00:00Z', dmUnreachableAt: null, accountStatus: 'active' as const }
  it('使える口座（active かつ到達不能マーク無し）があればその中で最後につないだもの', () => {
    const picked = store.pickPreferredUserLink([
      { ...base, id: 'a', channelAccountId: 'line', linkedAt: '2026-09-01T00:00:00Z' },
      { ...base, id: 'b', channelAccountId: 'slack', linkedAt: '2026-09-05T00:00:00Z' },
    ])
    expect(picked?.channelAccountId).toBe('slack')
  })
  it('新しい方の口座が disabled なら、古くても生きている方を選ぶ（リマインドが消えない）', () => {
    const picked = store.pickPreferredUserLink([
      { ...base, id: 'a', channelAccountId: 'line', linkedAt: '2026-09-01T00:00:00Z' },
      { ...base, id: 'b', channelAccountId: 'slack', linkedAt: '2026-09-05T00:00:00Z', accountStatus: 'disabled' },
    ])
    expect(picked?.channelAccountId).toBe('line')
  })
  it('新しい方が到達不能マーク済みなら、古い方を選ぶ', () => {
    const picked = store.pickPreferredUserLink([
      { ...base, id: 'a', channelAccountId: 'line', linkedAt: '2026-09-01T00:00:00Z' },
      { ...base, id: 'b', channelAccountId: 'slack', linkedAt: '2026-09-05T00:00:00Z', dmUnreachableAt: '2026-09-06T00:00:00Z' },
    ])
    expect(picked?.channelAccountId).toBe('line')
  })
  it('使える口座が無ければ最新1件を返す（送信は従来どおり試み、sender が disabled を no_route にする）', () => {
    const picked = store.pickPreferredUserLink([
      { ...base, id: 'a', channelAccountId: 'line', linkedAt: '2026-09-01T00:00:00Z', accountStatus: 'disabled' },
      { ...base, id: 'b', channelAccountId: 'slack', linkedAt: '2026-09-05T00:00:00Z', accountStatus: 'disabled' },
    ])
    expect(picked?.channelAccountId).toBe('slack')
  })
  it('同時刻なら id 降順で決定的', () => {
    const picked = store.pickPreferredUserLink([
      { ...base, id: 'a', channelAccountId: 'one' },
      { ...base, id: 'b', channelAccountId: 'two' },
    ])
    expect(picked?.channelAccountId).toBe('two')
  })
  it('空なら null', () => {
    expect(store.pickPreferredUserLink([])).toBeNull()
  })
})

describe('findActiveUserLinkForUser', () => {
  // 候補を全部取ってから pickPreferredUserLink で選ぶ（「最新1件を選んでから捨てる」をやめた・H-1）。
  // digest 安全網（findUserIdsWithActiveLink）と同じ述語で判定するため、口座 status と
  // dm_unreachable_at を読む（sender はマークの有無で送信を止めない＝A案は維持）。

  it('active な紐付けがあれば {channelAccountId, externalUserId} を返す', async () => {
    fromResponse = {
      data: [{ id: 'l1', channel_account_id: 'acc-1', external_user_id: 'U-1', linked_at: '2026-09-01T00:00:00Z', dm_unreachable_at: null, channel_accounts: { status: 'active' } }],
      error: null,
    }
    fromMock.mockImplementation(() => chain(fromResponse))
    const r = await store.findActiveUserLinkForUser('org-1', 'user-1')
    expect(r).toEqual({ channelAccountId: 'acc-1', externalUserId: 'U-1' })
  })

  it('該当なしはnull', async () => {
    fromResponse = { data: [], error: null }
    fromMock.mockImplementation(() => chain(fromResponse))
    expect(await store.findActiveUserLinkForUser('org-1', 'user-x')).toBeNull()
  })

  it('org_id/user_id/revoked_at is null で絞り、口座 status と dm_unreachable_at を選択に含める（DB 側で status/マークは絞らない＝選ぶのは TS 側）', async () => {
    fromResponse = { data: [], error: null }
    fromMock.mockImplementation(() => chain(fromResponse))
    await store.findActiveUserLinkForUser('org-1', 'user-1')

    expect(fromMock).toHaveBeenCalledWith('channel_user_links')
    const call = fromMock.mock.results[0].value
    expect(call.select).toHaveBeenCalledWith(expect.stringContaining('dm_unreachable_at'))
    expect(call.select).toHaveBeenCalledWith(expect.stringContaining('channel_accounts!inner(status)'))
    expect(call.eq).toHaveBeenCalledWith('org_id', 'org-1')
    expect(call.eq).toHaveBeenCalledWith('user_id', 'user-1')
    expect(call.is).toHaveBeenCalledWith('revoked_at', null)
    expect(call.is).not.toHaveBeenCalledWith('dm_unreachable_at', null)
    expect(call.eq).not.toHaveBeenCalledWith('channel_accounts.status', 'active')
  })

  it('LINE と Slack の両方につないでいて新しい方（Slack）の口座が disabled なら、生きている LINE を選ぶ', async () => {
    fromResponse = {
      data: [
        { id: 'l1', channel_account_id: 'acc-line', external_user_id: 'U-line', linked_at: '2026-09-01T00:00:00Z', dm_unreachable_at: null, channel_accounts: { status: 'active' } },
        { id: 'l2', channel_account_id: 'acc-slack', external_user_id: 'U-slack', linked_at: '2026-09-05T00:00:00Z', dm_unreachable_at: null, channel_accounts: { status: 'disabled' } },
      ],
      error: null,
    }
    fromMock.mockImplementation(() => chain(fromResponse))
    expect(await store.findActiveUserLinkForUser('org-1', 'user-1')).toEqual({ channelAccountId: 'acc-line', externalUserId: 'U-line' })
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

  it('H-1 是正: 口座 status と dm_unreachable_at を選択に含め、sender と同じ述語（TS 側）で判定する', async () => {
    fromResponse = { data: [], error: null }
    fromMock.mockImplementation(() => chain(fromResponse))
    await store.findUserIdsWithActiveLink('org-1', ['u-1'])

    const call = fromMock.mock.results[0].value
    expect(call.select).toHaveBeenCalledWith(expect.stringContaining('channel_accounts!inner(status)'))
    expect(call.select).toHaveBeenCalledWith(expect.stringContaining('dm_unreachable_at'))
  })

  it('使える口座（active かつマーク無し）が1つも無い担当者は「DMルート無し」＝結果setに含まれない（digest が拾う）', async () => {
    fromResponse = {
      data: [
        { user_id: 'u-reachable', dm_unreachable_at: null, channel_accounts: { status: 'active' } },
        { user_id: 'u-unreachable', dm_unreachable_at: '2026-09-01T00:00:00Z', channel_accounts: { status: 'active' } },
        { user_id: 'u-disabled', dm_unreachable_at: null, channel_accounts: { status: 'disabled' } },
        // 新しい Slack が disabled でも古い LINE が生きていれば DM ルートあり（sender の選び方と一致）
        { user_id: 'u-both', dm_unreachable_at: null, channel_accounts: { status: 'disabled' } },
        { user_id: 'u-both', dm_unreachable_at: null, channel_accounts: { status: 'active' } },
      ],
      error: null,
    }
    fromMock.mockImplementation(() => chain(fromResponse))
    const result = await store.findUserIdsWithActiveLink('org-1', ['u-reachable', 'u-unreachable', 'u-disabled', 'u-both'])
    expect([...result].sort()).toEqual(['u-both', 'u-reachable'])
  })

  it('active linkのあるuser_idの集合を返す', async () => {
    fromResponse = { data: [{ user_id: 'u-1', dm_unreachable_at: null, channel_accounts: { status: 'active' } }], error: null }
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

describe('listActiveOrgDmLinks（LINE 到達性照合ジョブの入力）', () => {
  it('M-5 是正: LINE 口座の紐づけだけを返す（Slack の user id を LINE の profile API に投げない）', async () => {
    fromResponse = { data: [], error: null }
    fromMock.mockImplementation(() => chain(fromResponse))
    await store.listActiveOrgDmLinks()
    const call = fromMock.mock.results[0].value
    expect(call.eq).toHaveBeenCalledWith('channel_accounts.channel', 'line')
  })
})
