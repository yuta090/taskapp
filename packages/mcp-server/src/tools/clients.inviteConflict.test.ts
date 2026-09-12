import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 招待の種類がその人の組織の役割と合わないとき（DB の決まり・IRC01 / IRC02 / IRC03）は、
 * 道具も決まった日本語で 409 を返す。まとめて作る経路は、断られた宛先だけを failed に入れて残りは作る。
 * それ以外の例外は、理由を呼び手に返さない（中身を隠した 500 のまま）。
 */
type Err = { message: string; code?: string; details?: string } | null

let insertErrorByEmail: Record<string, Err> = {}
let insertError: Err = null
let updateError: Err = null
let existingInvite: Record<string, unknown> | null = null

function invitesChain() {
  const c: Record<string, unknown> = { __update: false, __insert: null as Record<string, unknown> | null }
  for (const m of ['select', 'eq', 'is', 'gt']) c[m] = () => c
  c.maybeSingle = async () => ({ data: existingInvite, error: null })
  c.insert = (p: Record<string, unknown>) => {
    c.__insert = p
    return c
  }
  c.update = (p: Record<string, unknown>) => {
    c.__update = true
    c.__insert = p
    return c
  }
  c.single = async () => {
    if (c.__update) {
      return updateError
        ? { data: null, error: updateError }
        : { data: { id: 'inv-1', role: 'client', token: 'tok-1', email: 'x@example.com' }, error: null }
    }
    const row = c.__insert as Record<string, unknown> | null
    const email = String(row?.email ?? '')
    const err = insertErrorByEmail[email] ?? insertError
    return err ? { data: null, error: err } : { data: { ...row, id: `inv-${email}` }, error: null }
  }
  return c
}

vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      if (table === 'spaces') {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: { org_id: 'org-1' }, error: null }) }) }) }
      }
      return invitesChain()
    },
  }),
}))
vi.mock('../config.js', () => ({
  config: { orgId: 'org-1', actorId: 'actor-1' },
  getAuthContext: () => ({ keyId: 'k', userId: 'actor-1', orgId: 'org-1', scope: 'org', allowedSpaceIds: null, allowedActions: ['read', 'write', 'bulk'] }),
}))
vi.mock('../auth/helpers.js', () => ({
  checkAuth: async () => ({ ctx: { userId: 'actor-1' }, role: 'admin' }),
  checkAuthOrg: async () => ({ ctx: { orgId: 'org-1', userId: 'actor-1' } }),
}))

const { clientInviteCreate, clientInviteBulkCreate, clientInviteResend } = await import('./clients.js')
const S = '00000000-0000-0000-0000-000000000010'

beforeEach(() => {
  insertErrorByEmail = {}
  insertError = null
  updateError = null
  existingInvite = null
})

describe('client_invite_create — 決まった断りは日本語で 409', () => {
  it('IRC02（種類の違う承諾待ちがある）は ToolUserError(409)', async () => {
    insertError = { message: 'invite_pending_kind_conflict', code: 'IRC02' }

    await expect(
      clientInviteCreate({ email: 'a@example.com', spaceId: S, role: 'client', expiresInDays: 7 })
    ).rejects.toMatchObject({ name: 'ToolUserError', status: 409 })
  })

  it('IRC01 の文言は、参加している種類を伝える（英語の文言は返さない）', async () => {
    insertError = { message: 'invite_org_role_conflict', code: 'IRC01', details: 'org_role=member invite_role=client' }

    await expect(
      clientInviteCreate({ email: 'a@example.com', spaceId: S, role: 'client', expiresInDays: 7 })
    ).rejects.toThrow('この人はすでに社内メンバーとして参加しているため、この種類では招待できません')
  })

  it('知らない例外は呼び手に理由を返さない（ToolUserError にしない）', async () => {
    insertError = { message: 'duplicate key value violates unique constraint', code: '23505' }

    await expect(
      clientInviteCreate({ email: 'a@example.com', spaceId: S, role: 'client', expiresInDays: 7 })
    ).rejects.toMatchObject({ name: 'Error' })
  })
})

describe('client_invite_bulk_create — 断られた宛先だけ報告する', () => {
  it('1件断られても、ほかの宛先は作る', async () => {
    insertErrorByEmail['ng@example.com'] = {
      message: 'invite_org_role_conflict',
      code: 'IRC01',
      details: 'org_role=member invite_role=client',
    }

    const r = await clientInviteBulkCreate({
      emails: ['ok1@example.com', 'NG@example.com', 'ok2@example.com'],
      spaceId: S,
      expiresInDays: 7,
    })

    expect(r.created).toBe(2)
    expect(r.invites).toHaveLength(2)
    expect(r.failed).toHaveLength(1)
    expect(r.failed[0]).toContain('ng@example.com')
    expect(r.failed[0]).toContain('社内メンバーとして参加している')
  })

  it('同じ宛先が2回あっても1件だけ作る', async () => {
    const r = await clientInviteBulkCreate({
      emails: ['dup@example.com', 'DUP@example.com'],
      spaceId: S,
      expiresInDays: 7,
    })

    expect(r.created).toBe(1)
  })
})

describe('client_invite_resend — 送り直せないときの文言', () => {
  it('IRC01 は「送り直せません」＋409', async () => {
    updateError = { message: 'invite_org_role_conflict', code: 'IRC01', details: 'org_role=client invite_role=member' }

    await expect(clientInviteResend({ inviteId: 'inv-1', expiresInDays: 7 })).rejects.toMatchObject({
      name: 'ToolUserError',
      status: 409,
    })
  })
})
