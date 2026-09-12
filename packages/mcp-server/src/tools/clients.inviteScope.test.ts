import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * client_invite_create / client_invite_bulk_create — 招待の組織は space から取る
 * （鍵の組織ではない）。既存の招待の使い回しは、同じ space・同じ role の
 * 未受諾(accepted_at is null)・期限内(expires_at > now)のものに限る。
 */

const invitesCalls: Array<{ method: string; args: unknown[] }> = []
let existingInvite: unknown = null
let insertedInvites: Array<Record<string, unknown>> = []

function invitesChain() {
  const chain: Record<string, unknown> = {
    select: (...args: unknown[]) => {
      invitesCalls.push({ method: 'select', args })
      return chain
    },
    eq: (...args: unknown[]) => {
      invitesCalls.push({ method: 'eq', args })
      return chain
    },
    is: (...args: unknown[]) => {
      invitesCalls.push({ method: 'is', args })
      return chain
    },
    gt: (...args: unknown[]) => {
      invitesCalls.push({ method: 'gt', args })
      return chain
    },
    maybeSingle: async () => ({ data: existingInvite, error: null }),
    insert: (payload: Record<string, unknown> | Record<string, unknown>[]) => {
      insertedInvites = Array.isArray(payload) ? payload : [payload]
      return chain
    },
    update: () => chain,
    single: async () => ({ data: insertedInvites[0] ?? {}, error: null }),
  }
  return chain
}

// vi.mock は巻き上げられるため、ファクトリの中は const 参照ではなくリテラルにする
vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      if (table === 'spaces') {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: { org_id: 'org-from-space' }, error: null }) }) }) }
      }
      return invitesChain()
    },
  }),
}))
vi.mock('../config.js', () => ({
  config: { orgId: 'org-from-key', actorId: 'actor-1' },
}))
vi.mock('../auth/helpers.js', () => ({
  checkAuth: async () => ({ ctx: {}, role: 'admin' }),
  checkAuthOrg: async () => ({ ctx: { orgId: 'org-from-key' } }),
}))

const { clientInviteCreate, clientInviteBulkCreate } = await import('./clients.js')

const SPACE = '00000000-0000-0000-0000-000000000010'
const SPACE_ORG = 'org-from-space'

beforeEach(() => {
  invitesCalls.length = 0
  existingInvite = null
  insertedInvites = []
})

describe('client_invite_create — 組織は space から取る', () => {
  it('招待の組織は space の組織（鍵の組織ではない）', async () => {
    await clientInviteCreate({ email: 'a@example.com', spaceId: SPACE, role: 'client', expiresInDays: 7 })

    expect(insertedInvites[0]).toMatchObject({ org_id: SPACE_ORG, space_id: SPACE })
  })

  it('既存の招待の使い回しは space_id と role でも絞る', async () => {
    await clientInviteCreate({ email: 'a@example.com', spaceId: SPACE, role: 'client', expiresInDays: 7 })

    const eqArgs = invitesCalls.filter((c) => c.method === 'eq').map((c) => c.args)
    expect(eqArgs).toContainEqual(['space_id', SPACE])
    expect(eqArgs).toContainEqual(['role', 'client'])
  })

  it('既存の招待の使い回しは、未受諾(accepted_at is null)・期限内(expires_at > now)のものに限る', async () => {
    await clientInviteCreate({ email: 'a@example.com', spaceId: SPACE, role: 'client', expiresInDays: 7 })

    const isArgs = invitesCalls.filter((c) => c.method === 'is').map((c) => c.args)
    const gtArgs = invitesCalls.filter((c) => c.method === 'gt').map((c) => c.args)
    expect(isArgs).toContainEqual(['accepted_at', null])
    expect(gtArgs[0]?.[0]).toBe('expires_at')
  })
})

describe('client_invite_bulk_create — 組織は space から取る', () => {
  it('招待の組織は space の組織（鍵の組織ではない）', async () => {
    await clientInviteBulkCreate({ emails: ['a@example.com'], spaceId: SPACE, expiresInDays: 7 })

    expect(insertedInvites[0]).toMatchObject({ org_id: SPACE_ORG, space_id: SPACE })
  })
})
