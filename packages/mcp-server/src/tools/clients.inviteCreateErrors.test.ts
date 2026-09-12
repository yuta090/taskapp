import { describe, it, expect, vi } from 'vitest'

/**
 * client_invite_create: 見覚えのないDBの理由（決まった招待の文言に当てはまらない）は、
 * 生の文言を出さない一般のエラーにする。招待の使い回し(期限延長)の失敗も同じ。
 */

const SPACE = '00000000-0000-0000-0000-000000000010'
const genericError = { code: '42501', message: 'permission denied for table invites' }

let existingInvite: unknown = null

vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      if (table === 'spaces') return { select: () => ({ eq: () => ({ single: async () => ({ data: { org_id: 'org-1' }, error: null }) }) }) }
      if (table === 'invites') {
        const c: Record<string, unknown> = {}
        for (const m of ['select', 'eq', 'is', 'gt']) c[m] = () => c
        c.maybeSingle = async () => ({ data: existingInvite, error: null })
        c.insert = () => c
        c.update = () => c
        c.single = async () => ({ data: null, error: genericError })
        return c
      }
      throw new Error(`unexpected table: ${table}`)
    },
  }),
}))
vi.mock('../config.js', () => ({ config: { orgId: 'org-1', actorId: 'actor-1' } }))
vi.mock('../auth/helpers.js', () => ({ checkAuth: async () => ({ ctx: { userId: 'actor-1' }, role: 'admin' }) }))

const { clientInviteCreate } = await import('./clients.js')

describe('client_invite_create — 見覚えのないDBの理由は生の文言を出さない', () => {
  it('新規作成: 一般のエラーのまま（ToolUserErrorにしない）', async () => {
    existingInvite = null
    const err = await clientInviteCreate({ email: 'x@example.com', spaceId: SPACE, role: 'client', expiresInDays: 7 }).catch(
      (e: unknown) => e
    )

    expect(err).not.toMatchObject({ name: 'ToolUserError' })
    expect((err as Error).message).not.toContain('permission denied')
  })

  it('使い回し(期限延長): 一般のエラーのまま（ToolUserErrorにしない）', async () => {
    existingInvite = { id: 'inv-1', role: 'client', email: 'x@example.com' }
    const err = await clientInviteCreate({ email: 'x@example.com', spaceId: SPACE, role: 'client', expiresInDays: 7 }).catch(
      (e: unknown) => e
    )

    expect(err).not.toMatchObject({ name: 'ToolUserError' })
    expect((err as Error).message).not.toContain('permission denied')
  })
})
