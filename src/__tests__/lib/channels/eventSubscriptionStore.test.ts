import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Google Chat 全メッセージ購読状態 store（channel_event_subscriptions / PR-a）。
 *
 * - createEventSubscription: status='active'・resource_name=null で INSERT し id を返す。
 * - setEventSubscriptionResource: subscription 名と失効時刻を NULL→値 で埋める。
 * - findActiveSubscriptionByGroup: status='active' のみを返す（縮退した行は返さない）。
 * - findSubscriptionByResourceName: lifecycle イベントの逆引き。
 * - markSubscriptionStatus: expired/broken/deleted へ縮退させる。
 * - listActiveClaimedGroupsWithoutActiveSubscription: google_chat・active group のうち
 *   active 購読が無いものだけを差分で返す（space_name = external_group_id）。
 * - listSubscriptionsToRenew: active かつ expire_time < before を返す。
 * - listOrphanedActiveSubscriptions: active 購読のうち、対応する claimed google_chat
 *   グループ（active・space_id非null）がもう無いものを返す（PR-d: cron の delete-orphaned 用）。
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chain(response: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {}
  for (const m of ['select', 'eq', 'lt', 'not', 'insert', 'update']) {
    builder[m] = vi.fn(() => builder)
  }
  builder.single = vi.fn(() => Promise.resolve(response))
  builder.maybeSingle = vi.fn(() => Promise.resolve(response))
  // 終端に single/maybeSingle を呼ばず配列で await するクエリ用（thenable）
  builder.then = (resolve: (v: unknown) => unknown) => resolve(response)
  return builder
}

let fromResponses: Record<string, unknown>
let fromCallCount: number
const fromMock = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ from: fromMock })),
}))

const store = await import('@/lib/channels/store')

beforeEach(() => {
  vi.clearAllMocks()
  fromResponses = {}
  fromCallCount = 0
  fromMock.mockImplementation((table: string) => {
    fromCallCount += 1
    const key = `${table}#${fromCallCount}`
    const response = fromResponses[key] ?? fromResponses[table] ?? { data: null, error: null }
    return chain(response)
  })
})

const SUB_ROW = {
  id: 'sub-1',
  org_id: 'org-1',
  group_id: 'grp-1',
  account_id: 'acc-1',
  space_name: 'spaces/AAA',
  subscription_resource_name: null,
  status: 'active',
  expire_time: null,
  last_renew_error: null,
  created_at: '2026-07-23T00:00:00.000Z',
  updated_at: '2026-07-23T00:00:00.000Z',
}

describe('createEventSubscription', () => {
  it('active・resource_name=null で INSERT し id を返す', async () => {
    fromResponses['channel_event_subscriptions'] = { data: { id: 'sub-1' }, error: null }
    const result = await store.createEventSubscription({
      orgId: 'org-1',
      groupId: 'grp-1',
      accountId: 'acc-1',
      spaceName: 'spaces/AAA',
    })
    expect(result).toEqual({ id: 'sub-1' })
    const call = fromMock.mock.results[0].value
    expect(call.insert).toHaveBeenCalledWith({
      org_id: 'org-1',
      group_id: 'grp-1',
      account_id: 'acc-1',
      space_name: 'spaces/AAA',
    })
  })

  it('INSERT が失敗したら throw する', async () => {
    fromResponses['channel_event_subscriptions'] = {
      data: null,
      error: { message: 'duplicate key', code: '23505' },
    }
    await expect(
      store.createEventSubscription({
        orgId: 'org-1',
        groupId: 'grp-1',
        accountId: 'acc-1',
        spaceName: 'spaces/AAA',
      }),
    ).rejects.toThrow(/insert failed/)
  })
})

describe('setEventSubscriptionResource', () => {
  it('subscription 名と失効時刻・updated_at を UPDATE する', async () => {
    fromResponses['channel_event_subscriptions'] = { data: null, error: null }
    await store.setEventSubscriptionResource('sub-1', 'subscriptions/XYZ', '2026-08-01T00:00:00.000Z')
    const call = fromMock.mock.results[0].value
    const patch = call.update.mock.calls[0][0]
    expect(patch.subscription_resource_name).toBe('subscriptions/XYZ')
    expect(patch.expire_time).toBe('2026-08-01T00:00:00.000Z')
    expect(typeof patch.updated_at).toBe('string')
    expect(call.eq).toHaveBeenCalledWith('id', 'sub-1')
  })

  it('UPDATE エラーは throw する', async () => {
    fromResponses['channel_event_subscriptions'] = { data: null, error: { message: 'boom' } }
    await expect(
      store.setEventSubscriptionResource('sub-1', 'subscriptions/XYZ', null),
    ).rejects.toThrow(/set resource failed/)
  })
})

describe('findActiveSubscriptionByGroup', () => {
  it('status=active でフィルタして camelCase で返す', async () => {
    fromResponses['channel_event_subscriptions'] = { data: SUB_ROW, error: null }
    const result = await store.findActiveSubscriptionByGroup('grp-1')
    expect(result).toEqual({
      id: 'sub-1',
      orgId: 'org-1',
      groupId: 'grp-1',
      accountId: 'acc-1',
      spaceName: 'spaces/AAA',
      subscriptionResourceName: null,
      status: 'active',
      expireTime: null,
      lastRenewError: null,
      createdAt: '2026-07-23T00:00:00.000Z',
      updatedAt: '2026-07-23T00:00:00.000Z',
    })
    const call = fromMock.mock.results[0].value
    expect(call.eq).toHaveBeenCalledWith('group_id', 'grp-1')
    expect(call.eq).toHaveBeenCalledWith('status', 'active')
  })

  it('該当行が無ければ null', async () => {
    fromResponses['channel_event_subscriptions'] = { data: null, error: null }
    const result = await store.findActiveSubscriptionByGroup('grp-1')
    expect(result).toBeNull()
  })
})

describe('findSubscriptionByResourceName', () => {
  it('resource 名で逆引きして返す', async () => {
    fromResponses['channel_event_subscriptions'] = {
      data: { ...SUB_ROW, subscription_resource_name: 'subscriptions/XYZ', status: 'active' },
      error: null,
    }
    const result = await store.findSubscriptionByResourceName('subscriptions/XYZ')
    expect(result?.subscriptionResourceName).toBe('subscriptions/XYZ')
    const call = fromMock.mock.results[0].value
    expect(call.eq).toHaveBeenCalledWith('subscription_resource_name', 'subscriptions/XYZ')
  })
})

describe('markSubscriptionStatus', () => {
  it('broken へ縮退し last_renew_error を残す', async () => {
    fromResponses['channel_event_subscriptions'] = { data: null, error: null }
    await store.markSubscriptionStatus('sub-1', 'broken', 'permission revoked')
    const call = fromMock.mock.results[0].value
    const patch = call.update.mock.calls[0][0]
    expect(patch.status).toBe('broken')
    expect(patch.last_renew_error).toBe('permission revoked')
    expect(typeof patch.updated_at).toBe('string')
    expect(call.eq).toHaveBeenCalledWith('id', 'sub-1')
  })

  it('lastRenewError 省略時は last_renew_error を patch に含めない', async () => {
    fromResponses['channel_event_subscriptions'] = { data: null, error: null }
    await store.markSubscriptionStatus('sub-1', 'deleted')
    const call = fromMock.mock.results[0].value
    const patch = call.update.mock.calls[0][0]
    expect(patch.status).toBe('deleted')
    expect('last_renew_error' in patch).toBe(false)
  })
})

describe('listActiveClaimedGroupsWithoutActiveSubscription', () => {
  it('active 購読が無い google_chat group だけを space_name=external_group_id で返す', async () => {
    fromResponses['channel_groups'] = {
      data: [
        { id: 'grp-1', org_id: 'org-1', account_id: 'acc-1', external_group_id: 'spaces/AAA' },
        { id: 'grp-2', org_id: 'org-2', account_id: 'acc-1', external_group_id: 'spaces/BBB' },
      ],
      error: null,
    }
    // grp-2 は既に active 購読を持つ → 除外される
    fromResponses['channel_event_subscriptions'] = {
      data: [{ group_id: 'grp-2' }],
      error: null,
    }

    const result = await store.listActiveClaimedGroupsWithoutActiveSubscription()

    expect(result).toEqual([
      { groupId: 'grp-1', orgId: 'org-1', accountId: 'acc-1', spaceName: 'spaces/AAA' },
    ])

    const groupsCall = fromMock.mock.results[0].value
    expect(groupsCall.eq).toHaveBeenCalledWith('channel', 'google_chat')
    expect(groupsCall.eq).toHaveBeenCalledWith('status', 'active')
    // Fable裁定: space確定（space_id 非null）の claimed group のみ購読対象
    expect(groupsCall.not).toHaveBeenCalledWith('space_id', 'is', null)
    const subsCall = fromMock.mock.results[1].value
    expect(subsCall.eq).toHaveBeenCalledWith('status', 'active')
  })

  it('active group が無ければ購読テーブルを引かずに空配列', async () => {
    fromResponses['channel_groups'] = { data: [], error: null }
    const result = await store.listActiveClaimedGroupsWithoutActiveSubscription()
    expect(result).toEqual([])
    // channel_groups のみ引かれる（購読テーブルへの2回目のfromは呼ばれない）
    expect(fromMock).toHaveBeenCalledTimes(1)
  })
})

describe('listSubscriptionsToRenew', () => {
  it('active かつ expire_time < before を返す', async () => {
    fromResponses['channel_event_subscriptions'] = {
      data: [{ ...SUB_ROW, expire_time: '2026-07-30T00:00:00.000Z' }],
      error: null,
    }
    const result = await store.listSubscriptionsToRenew('2026-08-01T00:00:00.000Z')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('sub-1')
    const call = fromMock.mock.results[0].value
    expect(call.eq).toHaveBeenCalledWith('status', 'active')
    expect(call.lt).toHaveBeenCalledWith('expire_time', '2026-08-01T00:00:00.000Z')
  })
})

describe('listOrphanedActiveSubscriptions', () => {
  it('claimedなgoogle_chatグループが無くなったactive購読だけを返す', async () => {
    // sub-1: grp-1(orphan・もうclaimedでない) / sub-2: grp-2(まだclaimed=空配列に含まれない)
    fromResponses['channel_event_subscriptions#1'] = {
      data: [
        { id: 'sub-1', group_id: 'grp-1', subscription_resource_name: 'subscriptions/AAA' },
        { id: 'sub-2', group_id: 'grp-2', subscription_resource_name: 'subscriptions/BBB' },
      ],
      error: null,
    }
    fromResponses['channel_groups#2'] = {
      data: [{ id: 'grp-2' }],
      error: null,
    }

    const result = await store.listOrphanedActiveSubscriptions()

    expect(result).toEqual([{ id: 'sub-1', subscriptionResourceName: 'subscriptions/AAA' }])

    const subsCall = fromMock.mock.results[0].value
    expect(subsCall.eq).toHaveBeenCalledWith('status', 'active')
    const groupsCall = fromMock.mock.results[1].value
    expect(groupsCall.eq).toHaveBeenCalledWith('channel', 'google_chat')
    expect(groupsCall.eq).toHaveBeenCalledWith('status', 'active')
    expect(groupsCall.not).toHaveBeenCalledWith('space_id', 'is', null)
  })

  it('resource_nameがnullの行もそのまま返す(未確立のまま孤立した購読行)', async () => {
    fromResponses['channel_event_subscriptions#1'] = {
      data: [{ id: 'sub-3', group_id: 'grp-3', subscription_resource_name: null }],
      error: null,
    }
    fromResponses['channel_groups#2'] = { data: [], error: null }

    const result = await store.listOrphanedActiveSubscriptions()
    expect(result).toEqual([{ id: 'sub-3', subscriptionResourceName: null }])
  })

  it('active購読が無ければgroupsテーブルを引かずに空配列', async () => {
    fromResponses['channel_event_subscriptions#1'] = { data: [], error: null }
    const result = await store.listOrphanedActiveSubscriptions()
    expect(result).toEqual([])
    expect(fromMock).toHaveBeenCalledTimes(1)
  })

  it('全active購読がまだclaimed groupに紐づいていれば空配列', async () => {
    fromResponses['channel_event_subscriptions#1'] = {
      data: [{ id: 'sub-1', group_id: 'grp-1', subscription_resource_name: 'subscriptions/AAA' }],
      error: null,
    }
    fromResponses['channel_groups#2'] = { data: [{ id: 'grp-1' }], error: null }

    const result = await store.listOrphanedActiveSubscriptions()
    expect(result).toEqual([])
  })
})
