import { describe, it, expect, vi } from 'vitest'

/**
 * client_invite_create の getOrgId は、DBが断った理由を全部「スペースが見つかりません」の
 * 一般Errorに潰し、cause も残さなかった。0件（PGRST116）は ToolUserError(404)、それ以外は
 * 一般Errorのままだが、どちらも元のDBエラーを cause に残す。
 */

const SPACE = '00000000-0000-0000-0000-000000000010'
const USER = '00000000-0000-0000-0000-000000000001'

let spacesError: { code?: string; message?: string } | null = null
let membershipError: { code?: string; message?: string } | null = null

vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      if (table === 'spaces') return { select: () => ({ eq: () => ({ single: async () => ({ data: null, error: spacesError }) }) }) }
      if (table === 'space_memberships')
        return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: membershipError }) }) }) }) }
      return {}
    },
  }),
}))
vi.mock('../auth/helpers.js', () => ({
  checkAuth: async () => ({ ctx: { userId: 'actor-1' }, role: 'admin' }),
  checkAuthOrg: async () => ({ ctx: { orgId: 'org-1' } }),
}))
vi.mock('../auth/scope.js', () => ({ requireActorUserId: () => 'actor-1' }))

const { clientInviteCreate, clientUpdate } = await import('./clients.js')

describe('client_invite_create — getOrgId の断り方', () => {
  it('0件（PGRST116）は ToolUserError(404)、causeにDBエラーを残す', async () => {
    spacesError = { code: 'PGRST116', message: 'no rows' }

    const err = (await clientInviteCreate({ email: 'a@example.com', spaceId: SPACE, role: 'client', expiresInDays: 7 }).catch(
      (e: unknown) => e
    )) as Error & { status?: number; cause?: unknown }

    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
    expect(err.cause).toEqual(spacesError)
  })

  it('見覚えのない理由は一般のErrorのまま、causeにDBエラーを残す', async () => {
    spacesError = { code: '42501', message: 'permission denied for table spaces' }

    const err = (await clientInviteCreate({ email: 'a@example.com', spaceId: SPACE, role: 'client', expiresInDays: 7 }).catch(
      (e: unknown) => e
    )) as Error & { cause?: unknown }

    expect(err).not.toMatchObject({ name: 'ToolUserError' })
    expect(err.message).not.toContain('permission denied')
    expect(err.cause).toEqual(spacesError)
  })
})

describe('client_update — 現在の役割の確認の断り方', () => {
  it('見覚えのない理由は一般のErrorのまま、causeにDBエラーを残す', async () => {
    membershipError = { code: '42501', message: 'permission denied for table space_memberships' }

    const err = (await clientUpdate({ userId: USER, spaceId: SPACE, role: 'client' }).catch((e: unknown) => e)) as Error & {
      cause?: unknown
    }

    expect(err).not.toMatchObject({ name: 'ToolUserError' })
    expect(err.message).not.toContain('permission denied')
    expect(err.cause).toEqual(membershipError)
  })
})
