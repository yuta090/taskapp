import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useBillingLimits } from '@/lib/hooks/useBillingLimits'

/**
 * 「プランと請求」画面の使用状況。
 *
 * これが値を返さないと、有料プランの組織にも「無料プランをご利用中です」と表示され、
 * サブスクリプション管理ボタンも出ない（＝お金を払っているのに管理できない）。
 * サーバ側の真実源は /api/billing/limits（rpc_check_org_limits）。
 */

const ORG_ID = '11111111-2222-3333-4444-555555555555'

const RESPONSE = {
  plan_name: 'Pro',
  projects_limit: 30,
  projects_used: 28,
  members_limit: 30,
  members_used: 30,
  clients_limit: null,
  clients_used: 12,
  storage_limit_bytes: 1000,
  storage_used_bytes: 250,
}

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useBillingLimits', () => {
  it('orgId が無いうちは問い合わせない（組織の解決待ちで空振りさせない）', async () => {
    const fetchMock = mockFetchOnce(RESPONSE)
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useBillingLimits())

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.limits).toBeNull()
    expect(result.current.loading).toBe(false)
  })

  it('orgId が渡されたら使用状況を取ってくる', async () => {
    const fetchMock = mockFetchOnce(RESPONSE)
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useBillingLimits(ORG_ID))

    await waitFor(() => expect(result.current.limits).not.toBeNull())

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/billing/limits?org_id=${ORG_ID}`,
      expect.objectContaining({ credentials: 'same-origin' }),
    )
    expect(result.current.limits?.plan_name).toBe('Pro')
    expect(result.current.limits?.members_used).toBe(30)
    expect(result.current.error).toBeNull()
    expect(result.current.loading).toBe(false)
  })

  it('失敗したらエラーを立てる（画面は再読み込みボタンを出せる）', async () => {
    vi.stubGlobal('fetch', mockFetchOnce({ error: 'Access denied' }, false, 403))

    const { result } = renderHook(() => useBillingLimits(ORG_ID))

    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(result.current.limits).toBeNull()
  })

  it('通信そのものが落ちてもクラッシュしない', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    const { result } = renderHook(() => useBillingLimits(ORG_ID))

    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(result.current.loading).toBe(false)
  })

  describe('isAtLimit', () => {
    it('上限ちょうどは true・余裕があれば false・無制限は false', async () => {
      vi.stubGlobal('fetch', mockFetchOnce(RESPONSE))
      const { result } = renderHook(() => useBillingLimits(ORG_ID))
      await waitFor(() => expect(result.current.limits).not.toBeNull())

      expect(result.current.isAtLimit('members')).toBe(true)
      expect(result.current.isAtLimit('projects')).toBe(false)
      // clients_limit=null は無制限
      expect(result.current.isAtLimit('clients')).toBe(false)
    })

    it('まだ読めていないときは false（誤って上限扱いして操作を止めない）', () => {
      vi.stubGlobal('fetch', mockFetchOnce(RESPONSE))
      const { result } = renderHook(() => useBillingLimits())

      expect(result.current.isAtLimit('members')).toBe(false)
    })
  })

  describe('getRemainingCount', () => {
    it('残り枠を返す。無制限と未取得は null（警告を出さない）', async () => {
      vi.stubGlobal('fetch', mockFetchOnce(RESPONSE))
      const { result } = renderHook(() => useBillingLimits(ORG_ID))
      await waitFor(() => expect(result.current.limits).not.toBeNull())

      expect(result.current.getRemainingCount('projects')).toBe(2)
      expect(result.current.getRemainingCount('members')).toBe(0)
      expect(result.current.getRemainingCount('clients')).toBeNull()
    })
  })

  describe('refresh', () => {
    it('もう一度取り直す', async () => {
      const fetchMock = mockFetchOnce(RESPONSE)
      vi.stubGlobal('fetch', fetchMock)
      const { result } = renderHook(() => useBillingLimits(ORG_ID))
      await waitFor(() => expect(result.current.limits).not.toBeNull())

      await act(async () => {
        await result.current.refresh()
      })

      expect(fetchMock).toHaveBeenCalledTimes(2)
    })
  })
})
