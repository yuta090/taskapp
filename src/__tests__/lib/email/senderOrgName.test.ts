import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isPaidPlanId, resolveSenderOrgNames } from '@/lib/email/senderOrgName'

function adminWith(orgs: unknown[], billing: unknown[], fail = false) {
  return {
    from: (table: string) => ({
      select: () => ({
        in: () =>
          fail ? Promise.reject(new Error('down')) : Promise.resolve({ data: table === 'organizations' ? orgs : billing, error: null }),
      }),
    }),
  } as unknown as SupabaseClient
}

describe('resolveSenderOrgNames（事務所名の名乗りは有料プランだけ）', () => {
  it('有料プランの org だけ名前が返る', async () => {
    const m = await resolveSenderOrgNames(
      adminWith(
        [{ id: 'a', name: '有料社' }, { id: 'b', name: '無料社' }, { id: 'c', name: '請求行なし' }],
        [{ org_id: 'a', plan_id: 'pro' }, { org_id: 'b', plan_id: 'free' }],
      ),
      ['a', 'b', 'c'],
    )
    expect([...m.entries()]).toEqual([['a', '有料社']])
  })
  it('空・取得失敗なら空（名乗らない）', async () => {
    expect((await resolveSenderOrgNames(adminWith([], []), [])).size).toBe(0)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await resolveSenderOrgNames(adminWith([], [], true), ['a'])).size).toBe(0)
  })
  it('isPaidPlanId', () => {
    expect(isPaidPlanId('pro')).toBe(true)
    expect(isPaidPlanId('enterprise')).toBe(true)
    expect(isPaidPlanId('free')).toBe(false)
    expect(isPaidPlanId(null)).toBe(false)
  })
})
