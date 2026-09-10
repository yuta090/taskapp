import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * client_invite_create: 社内メンバー（role=member）も招待できること、
 * 同じ宛先に有効な招待があれば作り直さず期限だけ延ばすこと、招待リンクを返すこと。
 */
const inserted: Record<string, unknown>[] = []
const updated: Record<string, unknown>[] = []
let existingInvite: Record<string, unknown> | null = null

function chain() {
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'is', 'gt']) c[m] = () => c
  c.maybeSingle = async () => ({ data: existingInvite, error: null })
  c.single = async () => ({ data: { id: 'inv-1', role: (inserted.at(-1)?.role ?? existingInvite?.role ?? 'client'), token: 'tok-1', email: 'x@example.com' }, error: null })
  c.insert = (p: Record<string, unknown>) => { inserted.push(p); return c }
  c.update = (p: Record<string, unknown>) => { updated.push(p); return c }
  return c
}
vi.mock('../supabase/client.js', () => ({ getSupabaseClient: () => ({ from: () => chain() }) }))
vi.mock('../config.js', () => ({
  config: { orgId: 'org-1', actorId: 'actor-1' },
  getAuthContext: () => ({ keyId: 'k', userId: 'actor-1', orgId: 'org-1', scope: 'org', allowedSpaceIds: null, allowedActions: ['read', 'write', 'bulk'] }),
}))
vi.mock('../auth/helpers.js', () => ({ checkAuth: async () => ({ ctx: { userId: 'actor-1' }, role: 'admin' }) }))

const { clientInviteCreate } = await import('./clients.js')
const S = '00000000-0000-0000-0000-000000000010'

beforeEach(() => { inserted.length = 0; updated.length = 0; existingInvite = null })

describe('client_invite_create', () => {
  it('role=member で社内メンバーの招待を作り、/invite/ のリンクを返す', async () => {
    const r = await clientInviteCreate({ email: 'Tabata@Example.co.jp', spaceId: S, role: 'member', expiresInDays: 7 })
    expect(inserted[0]).toMatchObject({ role: 'member', email: 'tabata@example.co.jp' })
    expect(r.inviteUrl).toContain('/invite/')
    expect(r.reused).toBe(false)
    expect(r.emailSent).toBe(false)
  })

  it('既定は相手先（client）で、ポータルのリンクを返す', async () => {
    const r = await clientInviteCreate({ email: 'c@example.com', spaceId: S, role: 'client', expiresInDays: 7 })
    expect(inserted[0]).toMatchObject({ role: 'client' })
    expect(r.inviteUrl).toContain('/portal/')
  })

  it('同じ宛先に有効な招待があれば作り直さず期限だけ延ばす', async () => {
    existingInvite = { id: 'inv-old', role: 'member', token: 'tok-old', email: 'x@example.com' }
    const r = await clientInviteCreate({ email: 'x@example.com', spaceId: S, role: 'member', expiresInDays: 14 })
    expect(inserted).toHaveLength(0)
    expect(updated[0]).toHaveProperty('expires_at')
    expect(r.reused).toBe(true)
  })
})
