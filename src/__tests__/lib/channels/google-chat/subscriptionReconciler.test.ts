import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  reconcileGoogleChatSubscriptions,
  type GoogleChatSubscriptionReconcilerDeps,
} from '@/lib/channels/google-chat/subscriptionReconciler'

/**
 * Google Chat 購読ライフサイクルの自己修復cron（PR-d）の収束ループ本体。
 * inline hookは無し。deps注入の純関数として create-missing / renew-expiring /
 * delete-orphaned の3フェーズを毎回まわし、1件の失敗が他件を止めないことを検証する。
 */

function makeDeps(overrides: Partial<GoogleChatSubscriptionReconcilerDeps> = {}): GoogleChatSubscriptionReconcilerDeps {
  return {
    listMissing: vi.fn(async () => []),
    createSubscription: vi.fn(async () => ({ name: 'subscriptions/NEW-1', expireTime: '2026-08-01T00:00:00.000Z' })),
    createSubscriptionRow: vi.fn(async () => ({ id: 'row-1' })),
    setSubscriptionResource: vi.fn(async () => undefined),
    listToRenew: vi.fn(async () => []),
    renewSubscription: vi.fn(async () => ({ expireTime: '2026-09-01T00:00:00.000Z' })),
    listOrphaned: vi.fn(async () => []),
    deleteSubscription: vi.fn(async () => undefined),
    markSubscriptionStatus: vi.fn(async () => undefined),
    now: () => new Date('2026-07-23T00:00:00.000Z'),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('reconcileGoogleChatSubscriptions: create-missing', () => {
  it('未購読のclaimed groupに対しcreateSubscription→createSubscriptionRow→setSubscriptionResourceを呼び created を数える', async () => {
    const deps = makeDeps({
      listMissing: vi.fn(async () => [
        { groupId: 'grp-1', orgId: 'org-1', accountId: 'acc-1', spaceName: 'spaces/AAA' },
      ]),
    })
    const summary = await reconcileGoogleChatSubscriptions(deps)

    expect(deps.createSubscription).toHaveBeenCalledWith('spaces/AAA')
    expect(deps.createSubscriptionRow).toHaveBeenCalledWith({
      orgId: 'org-1',
      groupId: 'grp-1',
      accountId: 'acc-1',
      spaceName: 'spaces/AAA',
    })
    expect(deps.setSubscriptionResource).toHaveBeenCalledWith(
      'row-1',
      'subscriptions/NEW-1',
      '2026-08-01T00:00:00.000Z',
    )
    expect(summary.created).toBe(1)
    expect(summary.broken).toBe(0)
  })

  it('Google側のcreateSubscriptionが失敗したら行を作らずcontinueする(次回リトライ)', async () => {
    const deps = makeDeps({
      listMissing: vi.fn(async () => [
        { groupId: 'grp-1', orgId: 'org-1', accountId: 'acc-1', spaceName: 'spaces/AAA' },
      ]),
      createSubscription: vi.fn(async () => {
        throw new Error('google api error')
      }),
    })
    const summary = await reconcileGoogleChatSubscriptions(deps)

    expect(deps.createSubscriptionRow).not.toHaveBeenCalled()
    expect(deps.setSubscriptionResource).not.toHaveBeenCalled()
    expect(deps.markSubscriptionStatus).not.toHaveBeenCalled()
    expect(summary.created).toBe(0)
    expect(summary.broken).toBe(0)
  })

  it('row作成が失敗したらcontinueする(Google側は作成済みだが次回ALREADY_EXISTS経由で回収させる)', async () => {
    const deps = makeDeps({
      listMissing: vi.fn(async () => [
        { groupId: 'grp-1', orgId: 'org-1', accountId: 'acc-1', spaceName: 'spaces/AAA' },
      ]),
      createSubscriptionRow: vi.fn(async () => {
        throw new Error('insert failed')
      }),
    })
    const summary = await reconcileGoogleChatSubscriptions(deps)

    expect(deps.setSubscriptionResource).not.toHaveBeenCalled()
    expect(deps.markSubscriptionStatus).not.toHaveBeenCalled()
    expect(summary.created).toBe(0)
    expect(summary.broken).toBe(0)
  })

  it('row作成後にresourceセットが失敗したらmarkSubscriptionStatus(id,broken,err)を呼ぶ', async () => {
    const deps = makeDeps({
      listMissing: vi.fn(async () => [
        { groupId: 'grp-1', orgId: 'org-1', accountId: 'acc-1', spaceName: 'spaces/AAA' },
      ]),
      setSubscriptionResource: vi.fn(async () => {
        throw new Error('set resource failed')
      }),
    })
    const summary = await reconcileGoogleChatSubscriptions(deps)

    expect(deps.markSubscriptionStatus).toHaveBeenCalledWith('row-1', 'broken', 'set resource failed')
    expect(summary.created).toBe(0)
    expect(summary.broken).toBe(1)
  })

  it('複数件のうち1件が失敗しても他は処理される', async () => {
    const deps = makeDeps({
      listMissing: vi.fn(async () => [
        { groupId: 'grp-1', orgId: 'org-1', accountId: 'acc-1', spaceName: 'spaces/AAA' },
        { groupId: 'grp-2', orgId: 'org-1', accountId: 'acc-1', spaceName: 'spaces/BBB' },
      ]),
      createSubscription: vi.fn(async (spaceName: string) => {
        if (spaceName === 'spaces/AAA') throw new Error('boom')
        return { name: 'subscriptions/NEW-2', expireTime: '2026-08-02T00:00:00.000Z' }
      }),
    })
    const summary = await reconcileGoogleChatSubscriptions(deps)

    expect(summary.created).toBe(1)
    expect(deps.createSubscriptionRow).toHaveBeenCalledTimes(1)
    expect(deps.createSubscriptionRow).toHaveBeenCalledWith({
      orgId: 'org-1',
      groupId: 'grp-2',
      accountId: 'acc-1',
      spaceName: 'spaces/BBB',
    })
  })
})

describe('reconcileGoogleChatSubscriptions: renew-expiring', () => {
  it('猶予内の購読にrenewSubscription+setSubscriptionResourceを呼び renewed を数える', async () => {
    const deps = makeDeps({
      listToRenew: vi.fn(async () => [{ id: 'sub-1', subscriptionResourceName: 'subscriptions/SUB-1' }]),
    })
    const summary = await reconcileGoogleChatSubscriptions(deps)

    expect(deps.renewSubscription).toHaveBeenCalledWith('subscriptions/SUB-1')
    expect(deps.setSubscriptionResource).toHaveBeenCalledWith(
      'sub-1',
      'subscriptions/SUB-1',
      '2026-09-01T00:00:00.000Z',
    )
    expect(summary.renewed).toBe(1)
  })

  it('deps.now基準の猶予境界(now+24h)でlistToRenewを呼ぶ', async () => {
    const deps = makeDeps({ now: () => new Date('2026-07-23T00:00:00.000Z') })
    await reconcileGoogleChatSubscriptions(deps)
    expect(deps.listToRenew).toHaveBeenCalledWith('2026-07-24T00:00:00.000Z')
  })

  it('resourceNameが無い(未確立)行はスキップする(create-missineが後で処理する)', async () => {
    const deps = makeDeps({
      listToRenew: vi.fn(async () => [{ id: 'sub-1', subscriptionResourceName: null }]),
    })
    const summary = await reconcileGoogleChatSubscriptions(deps)
    expect(deps.renewSubscription).not.toHaveBeenCalled()
    expect(summary.renewed).toBe(0)
  })

  it('恒久失敗(renewSubscriptionが例外)はmarkSubscriptionStatus(id,broken,err)を呼ぶ', async () => {
    const deps = makeDeps({
      listToRenew: vi.fn(async () => [{ id: 'sub-1', subscriptionResourceName: 'subscriptions/SUB-1' }]),
      renewSubscription: vi.fn(async () => {
        throw new Error('renew failed (404)')
      }),
    })
    const summary = await reconcileGoogleChatSubscriptions(deps)

    expect(deps.markSubscriptionStatus).toHaveBeenCalledWith('sub-1', 'broken', 'renew failed (404)')
    expect(summary.renewed).toBe(0)
    expect(summary.broken).toBe(1)
  })

  it('複数件のうち1件が失敗しても他は処理される', async () => {
    const deps = makeDeps({
      listToRenew: vi.fn(async () => [
        { id: 'sub-1', subscriptionResourceName: 'subscriptions/SUB-1' },
        { id: 'sub-2', subscriptionResourceName: 'subscriptions/SUB-2' },
      ]),
      renewSubscription: vi.fn(async (resourceName: string) => {
        if (resourceName === 'subscriptions/SUB-1') throw new Error('boom')
        return { expireTime: '2026-09-05T00:00:00.000Z' }
      }),
    })
    const summary = await reconcileGoogleChatSubscriptions(deps)

    expect(summary.renewed).toBe(1)
    expect(summary.broken).toBe(1)
  })
})

describe('reconcileGoogleChatSubscriptions: delete-orphaned', () => {
  it('orphan購読にdeleteSubscription+markSubscriptionStatus(id,deleted)を呼ぶ', async () => {
    const deps = makeDeps({
      listOrphaned: vi.fn(async () => [{ id: 'sub-1', subscriptionResourceName: 'subscriptions/SUB-1' }]),
    })
    const summary = await reconcileGoogleChatSubscriptions(deps)

    expect(deps.deleteSubscription).toHaveBeenCalledWith('subscriptions/SUB-1')
    expect(deps.markSubscriptionStatus).toHaveBeenCalledWith('sub-1', 'deleted')
    expect(summary.deleted).toBe(1)
  })

  it('resourceNameが無ければdeleteSubscriptionを呼ばずmarkSubscriptionStatusのみ呼ぶ', async () => {
    const deps = makeDeps({
      listOrphaned: vi.fn(async () => [{ id: 'sub-2', subscriptionResourceName: null }]),
    })
    const summary = await reconcileGoogleChatSubscriptions(deps)

    expect(deps.deleteSubscription).not.toHaveBeenCalled()
    expect(deps.markSubscriptionStatus).toHaveBeenCalledWith('sub-2', 'deleted')
    expect(summary.deleted).toBe(1)
  })

  it('deleteSubscriptionが失敗したらmarkSubscriptionStatusを呼ばずcontinueする(次回リトライ)', async () => {
    const deps = makeDeps({
      listOrphaned: vi.fn(async () => [{ id: 'sub-1', subscriptionResourceName: 'subscriptions/SUB-1' }]),
      deleteSubscription: vi.fn(async () => {
        throw new Error('delete failed')
      }),
    })
    const summary = await reconcileGoogleChatSubscriptions(deps)

    expect(deps.markSubscriptionStatus).not.toHaveBeenCalled()
    expect(summary.deleted).toBe(0)
  })

  it('複数件のうち1件が失敗しても他は処理される', async () => {
    const deps = makeDeps({
      listOrphaned: vi.fn(async () => [
        { id: 'sub-1', subscriptionResourceName: 'subscriptions/SUB-1' },
        { id: 'sub-2', subscriptionResourceName: 'subscriptions/SUB-2' },
      ]),
      deleteSubscription: vi.fn(async (resourceName: string) => {
        if (resourceName === 'subscriptions/SUB-1') throw new Error('boom')
      }),
    })
    const summary = await reconcileGoogleChatSubscriptions(deps)

    expect(summary.deleted).toBe(1)
    expect(deps.markSubscriptionStatus).toHaveBeenCalledWith('sub-2', 'deleted')
    expect(deps.markSubscriptionStatus).not.toHaveBeenCalledWith('sub-1', 'deleted')
  })
})

describe('reconcileGoogleChatSubscriptions: summary', () => {
  it('3フェーズを合算したサマリを返す', async () => {
    const deps = makeDeps({
      listMissing: vi.fn(async () => [
        { groupId: 'grp-1', orgId: 'org-1', accountId: 'acc-1', spaceName: 'spaces/AAA' },
      ]),
      listToRenew: vi.fn(async () => [{ id: 'sub-2', subscriptionResourceName: 'subscriptions/SUB-2' }]),
      listOrphaned: vi.fn(async () => [{ id: 'sub-3', subscriptionResourceName: 'subscriptions/SUB-3' }]),
    })
    const summary = await reconcileGoogleChatSubscriptions(deps)
    expect(summary).toEqual({ created: 1, renewed: 1, broken: 0, deleted: 1 })
  })

  it('now省略時はDate.nowベースで動作する(例外にならない)', async () => {
    const deps = makeDeps()
    delete (deps as Partial<GoogleChatSubscriptionReconcilerDeps>).now
    await expect(reconcileGoogleChatSubscriptions(deps)).resolves.toEqual({
      created: 0,
      renewed: 0,
      broken: 0,
      deleted: 0,
    })
  })
})
