import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolvePostLoginLanding } from '@/lib/auth/resolveLanding'

/**
 * ログイン後の着地判定（LoginClient / auth/callback 共通ロジック）。
 * 判定は org_memberships → (client なら space_memberships の vendor 有無 / それ以外なら spaces) の順。
 */

interface FakeOpts {
  memberships: { org_id: string; role: string }[] | null
  membershipsError?: { message: string } | null
  vendorData?: { id: string } | null
  spaceData?: { id: string } | null
}

function makeSupabase({
  memberships,
  membershipsError = null,
  vendorData = null,
  spaceData = null,
}: FakeOpts): SupabaseClient {
  return {
    from: (table: string) => {
      if (table === 'org_memberships') {
        return {
          select: () => ({
            eq: () => ({
              order: () => Promise.resolve({ data: memberships, error: membershipsError }),
            }),
          }),
        }
      }
      if (table === 'space_memberships') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  limit: () => ({
                    maybeSingle: () => Promise.resolve({ data: vendorData }),
                  }),
                }),
              }),
            }),
          }),
        }
      }
      // spaces
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  single: () => Promise.resolve({ data: spaceData }),
                }),
              }),
            }),
          }),
        }),
      }
    },
  } as unknown as SupabaseClient
}

describe('resolvePostLoginLanding', () => {
  it('組織未所属なら /onboarding へ', async () => {
    const supabase = makeSupabase({ memberships: [] })

    const result = await resolvePostLoginLanding(supabase, 'user-1')

    expect(result).toBe('/onboarding')
  })

  it('組織はあるがプロジェクトが無ければ /onboarding へ（Step2から再開）', async () => {
    const supabase = makeSupabase({
      memberships: [{ org_id: 'org-1', role: 'owner' }],
      spaceData: null,
    })

    const result = await resolvePostLoginLanding(supabase, 'user-1')

    expect(result).toBe('/onboarding')
  })

  it('組織もプロジェクトもあれば最初のプロジェクトへ', async () => {
    const supabase = makeSupabase({
      memberships: [{ org_id: 'org-1', role: 'owner' }],
      spaceData: { id: 'space-1' },
    })

    const result = await resolvePostLoginLanding(supabase, 'user-1')

    expect(result).toBe('/org-1/project/space-1')
  })

  it('clientロールでvendor所属が無ければ /portal へ', async () => {
    const supabase = makeSupabase({
      memberships: [{ org_id: 'org-1', role: 'client' }],
      vendorData: null,
    })

    const result = await resolvePostLoginLanding(supabase, 'user-1')

    expect(result).toBe('/portal')
  })

  it('clientロールでも同org内にvendorのspace所属があれば /vendor-portal へ（Googleログインのベンダーが/portalで行き止まりにならない）', async () => {
    const supabase = makeSupabase({
      memberships: [{ org_id: 'org-1', role: 'client' }],
      vendorData: { id: 'sm-1' },
    })

    const result = await resolvePostLoginLanding(supabase, 'user-1')

    expect(result).toBe('/vendor-portal')
  })

  it('preferredOrgId が所属org内にあればそれを優先する（ACTIVE_ORG_COOKIE切替中の着地）', async () => {
    const supabase = makeSupabase({
      memberships: [
        { org_id: 'org-1', role: 'owner' },
        { org_id: 'org-2', role: 'client' },
      ],
      vendorData: null,
    })

    const result = await resolvePostLoginLanding(supabase, 'user-1', { preferredOrgId: 'org-2' })

    expect(result).toBe('/portal')
  })

  it('preferredOrgId が所属していないorgなら無視して先頭(created_at昇順)を採用する', async () => {
    const supabase = makeSupabase({
      memberships: [
        { org_id: 'org-1', role: 'owner' },
        { org_id: 'org-2', role: 'client' },
      ],
      spaceData: { id: 'space-1' },
    })

    const result = await resolvePostLoginLanding(supabase, 'user-1', { preferredOrgId: 'org-not-a-member' })

    expect(result).toBe('/org-1/project/space-1')
  })

  it('membershipクエリがエラーなら例外を投げる（呼び出し元でfail-closedさせる）', async () => {
    const supabase = makeSupabase({
      memberships: null,
      membershipsError: { message: 'db error' },
    })

    await expect(resolvePostLoginLanding(supabase, 'user-1')).rejects.toThrow()
  })
})
