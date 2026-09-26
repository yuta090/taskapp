import { describe, it, expect, vi } from 'vitest'

/**
 * activity_search（を含む全ツール共通の getOrgId）は、spaces の取得が断られた理由を
 * 全部「スペースが見つかりません」に潰し、cause も残さなかった。
 * 0件（PGRST116）は本当に見つからないので ToolUserError(404) でよいが、それ以外
 * （権限エラー等）は一般Errorのまま、どちらも元のDBエラーを cause に残す。
 */

const SPACE = '00000000-0000-0000-0000-000000000010'

let spacesError: { code?: string; message?: string } | null = null

vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({
    from: (table: string) =>
      table === 'spaces'
        ? { select: () => ({ eq: () => ({ single: async () => ({ data: null, error: spacesError }) }) }) }
        : { select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) }) }) },
  }),
}))
vi.mock('../auth/helpers.js', () => ({ checkAuth: async () => ({ ctx: {} }), checkAuthOrg: async () => ({ ctx: { orgId: 'org-1' } }) }))
vi.mock('../config.js', () => ({ config: { actorId: 'actor-1' } }))

const { activitySearch } = await import('./activity.js')

describe('activity_search — getOrgId の断り方', () => {
  it('0件（PGRST116）は ToolUserError(404)', async () => {
    spacesError = { code: 'PGRST116', message: 'no rows' }

    const err = (await activitySearch({ spaceId: SPACE, limit: 20 }).catch((e: unknown) => e)) as Error & {
      status?: number
      cause?: unknown
    }

    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
    expect(err.cause).toEqual(spacesError)
  })

  it('それ以外は一般のErrorのまま、cause に原因を残す', async () => {
    spacesError = { code: '42501', message: 'permission denied for table spaces' }

    const err = (await activitySearch({ spaceId: SPACE, limit: 20 }).catch((e: unknown) => e)) as Error & { cause?: unknown }

    expect(err).not.toMatchObject({ name: 'ToolUserError' })
    expect(err.message).not.toContain('permission denied')
    expect(err.cause).toEqual(spacesError)
  })
})
