import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * dmReachabilityReconcile: DM到達不能「安全網」の日次照合ジョブ（回収バッチ）。
 *
 * webhookのunfollow/follow(markDmUnreachable/clearDmUnreachable)は「導入前から
 * 既にブロック済み」「unfollowイベント自体の取りこぼし」を検知できない。listActiveOrgDmLinks
 * で対象(owner_type='org'のactiveな1:1紐付け)を一覧し、LINE 1:1 profile取得
 * (fetchLineUserProfile)で実際の到達可否を照合し直し、既存のmark/clearへ委譲する。
 *
 * - unreachable かつ未mark → markDmUnreachable
 * - reachable かつmark済み → clearDmUnreachable
 * - error（レート制限・5xx・ネットワーク） → 判定保留・どちらも呼ばない
 * - 既にunreachable状態のunreachable判定・既にreachable状態のreachable判定は、
 *   冪等な二重呼び出しを避けるため何もしない
 * - 1件のDB例外で全体を落とさない（ベストエフォート・次のlinkへ継続）
 * - 上限件数(limit)に達したら残りは次回に回す（ログ・truncated:true）
 * - throttle: LINE profile APIを連続で叩かない
 */

const storeMock = {
  listActiveOrgDmLinks: vi.fn(),
  markDmUnreachable: vi.fn(),
  clearDmUnreachable: vi.fn(),
}
vi.mock('@/lib/channels/store', () => storeMock)

const fetchLineUserProfileMock = vi.fn()
vi.mock('@/lib/channels/line/client', () => ({
  fetchLineUserProfile: (...args: unknown[]) => fetchLineUserProfileMock(...args),
}))

const { reconcileDmReachability } = await import('@/lib/channels/dmReachabilityReconcile')

function link(over: Record<string, unknown> = {}) {
  return {
    orgId: 'org-1',
    accountId: 'acc-1',
    accessToken: 'token-abc',
    externalUserId: 'U-1',
    dmUnreachableAt: null,
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  storeMock.listActiveOrgDmLinks.mockResolvedValue([])
  storeMock.markDmUnreachable.mockResolvedValue(undefined)
  storeMock.clearDmUnreachable.mockResolvedValue(undefined)
})

describe('reconcileDmReachability', () => {
  it('unreachable かつ未markのlinkは markDmUnreachable を呼ぶ', async () => {
    storeMock.listActiveOrgDmLinks.mockResolvedValue([link({ dmUnreachableAt: null })])
    fetchLineUserProfileMock.mockResolvedValue('unreachable')

    const summary = await reconcileDmReachability({ throttleMs: 0 })

    expect(storeMock.markDmUnreachable).toHaveBeenCalledWith('org-1', 'acc-1', 'U-1', expect.any(String))
    expect(storeMock.clearDmUnreachable).not.toHaveBeenCalled()
    expect(summary.marked).toBe(1)
    expect(summary.cleared).toBe(0)
    expect(summary.scanned).toBe(1)
  })

  it('reachable かつmark済みのlinkは clearDmUnreachable を呼ぶ', async () => {
    storeMock.listActiveOrgDmLinks.mockResolvedValue([
      link({ dmUnreachableAt: '2026-07-20T00:00:00.000Z' }),
    ])
    fetchLineUserProfileMock.mockResolvedValue('reachable')

    const summary = await reconcileDmReachability({ throttleMs: 0 })

    expect(storeMock.clearDmUnreachable).toHaveBeenCalledWith('org-1', 'acc-1', 'U-1', expect.any(String))
    expect(storeMock.markDmUnreachable).not.toHaveBeenCalled()
    expect(summary.cleared).toBe(1)
  })

  it('error（判定保留）は mark も clear も呼ばない', async () => {
    storeMock.listActiveOrgDmLinks.mockResolvedValue([link()])
    fetchLineUserProfileMock.mockResolvedValue('error')

    const summary = await reconcileDmReachability({ throttleMs: 0 })

    expect(storeMock.markDmUnreachable).not.toHaveBeenCalled()
    expect(storeMock.clearDmUnreachable).not.toHaveBeenCalled()
    expect(summary.errors).toBe(0)
    expect(summary.scanned).toBe(1)
  })

  it('unreachable判定だが既にmark済みなら markDmUnreachable を再度呼ばない（冪等）', async () => {
    storeMock.listActiveOrgDmLinks.mockResolvedValue([
      link({ dmUnreachableAt: '2026-07-20T00:00:00.000Z' }),
    ])
    fetchLineUserProfileMock.mockResolvedValue('unreachable')

    await reconcileDmReachability({ throttleMs: 0 })

    expect(storeMock.markDmUnreachable).not.toHaveBeenCalled()
    expect(storeMock.clearDmUnreachable).not.toHaveBeenCalled()
  })

  it('reachable判定だが未markなら clearDmUnreachable を呼ばない（冪等）', async () => {
    storeMock.listActiveOrgDmLinks.mockResolvedValue([link({ dmUnreachableAt: null })])
    fetchLineUserProfileMock.mockResolvedValue('reachable')

    await reconcileDmReachability({ throttleMs: 0 })

    expect(storeMock.clearDmUnreachable).not.toHaveBeenCalled()
    expect(storeMock.markDmUnreachable).not.toHaveBeenCalled()
  })

  it('1件のmarkDmUnreachable失敗があっても後続のlinkの処理を継続する（ベストエフォート）', async () => {
    storeMock.listActiveOrgDmLinks.mockResolvedValue([
      link({ externalUserId: 'U-1', dmUnreachableAt: null }),
      link({ externalUserId: 'U-2', dmUnreachableAt: null }),
    ])
    fetchLineUserProfileMock.mockResolvedValue('unreachable')
    storeMock.markDmUnreachable
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce(undefined)

    const summary = await reconcileDmReachability({ throttleMs: 0 })

    expect(storeMock.markDmUnreachable).toHaveBeenCalledTimes(2)
    expect(summary.scanned).toBe(2)
    expect(summary.marked).toBe(1)
    expect(summary.errors).toBe(1)
  })

  it('上限件数(limit)に達したら残りをtruncatedとして次回に回す', async () => {
    storeMock.listActiveOrgDmLinks.mockResolvedValue([
      link({ externalUserId: 'U-1' }),
      link({ externalUserId: 'U-2' }),
      link({ externalUserId: 'U-3' }),
    ])
    fetchLineUserProfileMock.mockResolvedValue('error')

    const summary = await reconcileDmReachability({ limit: 2, throttleMs: 0 })

    expect(fetchLineUserProfileMock).toHaveBeenCalledTimes(2)
    expect(summary.scanned).toBe(2)
    expect(summary.truncated).toBe(true)
  })

  it('limit未到達ならtruncated:false', async () => {
    storeMock.listActiveOrgDmLinks.mockResolvedValue([link()])
    fetchLineUserProfileMock.mockResolvedValue('error')

    const summary = await reconcileDmReachability({ limit: 500, throttleMs: 0 })
    expect(summary.truncated).toBe(false)
  })

  it('link間にthrottle(待機)を挟む', async () => {
    vi.useFakeTimers()
    storeMock.listActiveOrgDmLinks.mockResolvedValue([link({ externalUserId: 'U-1' }), link({ externalUserId: 'U-2' })])
    fetchLineUserProfileMock.mockResolvedValue('error')

    const promise = reconcileDmReachability({ throttleMs: 50 })
    // 1件目のprofile取得が終わった後、2件目に着手する前にthrottleで待たされているはず
    await vi.advanceTimersByTimeAsync(50)
    await promise

    expect(fetchLineUserProfileMock).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('0件ならfetchLineUserProfileを呼ばず即終了する', async () => {
    storeMock.listActiveOrgDmLinks.mockResolvedValue([])
    const summary = await reconcileDmReachability({ throttleMs: 0 })
    expect(fetchLineUserProfileMock).not.toHaveBeenCalled()
    expect(summary.scanned).toBe(0)
  })
})
