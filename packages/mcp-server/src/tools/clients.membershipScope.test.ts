import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * client_add_to_space / client_update は、呼べるのを space の admin だけに絞り、
 * 対象を space の組織のメンバーだけに限る。役割は組織での役割とそろえる
 * （組織 client → space client、それ以外 → space viewer）。client_update は
 * さらに admin・組織オーナー・自分自身の役割を変えさせない。
 */

let callerRole = 'admin'
let ctxUserId = 'caller-1'
let orgMembership: { role: string } | null = { role: 'member' }
let currentSpaceMembership: { role: string } | null = { role: 'viewer' }
const inserted: Record<string, unknown>[] = []
const updated: Record<string, unknown>[] = []

function spaceMembershipsChain() {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: currentSpaceMembership, error: null }),
    insert: (payload: Record<string, unknown>) => {
      inserted.push(payload)
      return chain
    },
    update: (payload: Record<string, unknown>) => {
      updated.push(payload)
      return chain
    },
    single: async () => ({ data: { ...currentSpaceMembership, ...updated.at(-1), ...inserted.at(-1) }, error: null }),
  }
  return chain
}

function orgMembershipsChain() {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    maybeSingle: async () => ({ data: orgMembership, error: null }),
    then: (resolve: (v: unknown) => void) =>
      resolve({ data: orgMembership ? [{ user_id: 'target-1', role: orgMembership.role }] : [], error: null }),
  }
  return chain
}

vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      if (table === 'spaces') {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: { org_id: 'org-1' }, error: null }) }) }) }
      }
      if (table === 'org_memberships') return orgMembershipsChain()
      return spaceMembershipsChain()
    },
  }),
}))
vi.mock('../auth/helpers.js', () => ({
  checkAuth: async () => ({ ctx: { userId: ctxUserId }, role: callerRole }),
}))

const { clientAddToSpace, clientUpdate } = await import('./clients.js')

const SPACE = '00000000-0000-0000-0000-000000000010'
const TARGET = 'target-1'

beforeEach(() => {
  callerRole = 'admin'
  ctxUserId = 'caller-1'
  orgMembership = { role: 'member' }
  currentSpaceMembership = { role: 'viewer' }
  inserted.length = 0
  updated.length = 0
})

describe('client_add_to_space', () => {
  it('admin 以外は呼べない', async () => {
    callerRole = 'editor'

    const err = await clientAddToSpace({ userId: TARGET, spaceId: SPACE, role: 'viewer' }).catch((e: unknown) => e)
    expect(err).toMatchObject({ name: 'ToolUserError', status: 403 })
    expect(inserted).toHaveLength(0)
  })

  it('組織外の人は追加できない', async () => {
    orgMembership = null

    const err = await clientAddToSpace({ userId: TARGET, spaceId: SPACE, role: 'viewer' }).catch((e: unknown) => e)
    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
    expect(inserted).toHaveLength(0)
  })

  it('組織での役割と合わないロールは拒否する（組織 client を viewer で追加しようとする）', async () => {
    orgMembership = { role: 'client' }

    const err = await clientAddToSpace({ userId: TARGET, spaceId: SPACE, role: 'viewer' }).catch((e: unknown) => e)
    expect(err).toMatchObject({ name: 'ToolUserError', status: 400 })
    expect(inserted).toHaveLength(0)
  })

  it('組織 client を role=client で追加できる', async () => {
    orgMembership = { role: 'client' }

    await clientAddToSpace({ userId: TARGET, spaceId: SPACE, role: 'client' })
    expect(inserted).toHaveLength(1)
  })

  it('組織 member を role=viewer で追加できる', async () => {
    orgMembership = { role: 'member' }

    await clientAddToSpace({ userId: TARGET, spaceId: SPACE, role: 'viewer' })
    expect(inserted).toHaveLength(1)
  })
})

describe('client_update', () => {
  it('admin 以外は呼べない', async () => {
    callerRole = 'editor'

    const err = await clientUpdate({ userId: TARGET, spaceId: SPACE, role: 'viewer' }).catch((e: unknown) => e)
    expect(err).toMatchObject({ name: 'ToolUserError', status: 403 })
    expect(updated).toHaveLength(0)
  })

  it('自分自身の役割は変更できない', async () => {
    ctxUserId = TARGET

    const err = await clientUpdate({ userId: TARGET, spaceId: SPACE, role: 'viewer' }).catch((e: unknown) => e)
    expect(err).toMatchObject({ name: 'ToolUserError', status: 403 })
    expect(updated).toHaveLength(0)
  })

  it('admin の役割は変更できない', async () => {
    currentSpaceMembership = { role: 'admin' }

    const err = await clientUpdate({ userId: TARGET, spaceId: SPACE, role: 'viewer' }).catch((e: unknown) => e)
    expect(err).toMatchObject({ name: 'ToolUserError', status: 403 })
    expect(updated).toHaveLength(0)
  })

  it('組織のオーナーの役割は変更できない', async () => {
    orgMembership = { role: 'owner' }

    const err = await clientUpdate({ userId: TARGET, spaceId: SPACE, role: 'viewer' }).catch((e: unknown) => e)
    expect(err).toMatchObject({ name: 'ToolUserError', status: 403 })
    expect(updated).toHaveLength(0)
  })

  it('通常のメンバーなら更新できる', async () => {
    await clientUpdate({ userId: TARGET, spaceId: SPACE, role: 'viewer' })
    expect(updated).toHaveLength(1)
  })

  it('組織 client の人を viewer に変えようとすると拒否する（相手先を社内扱いの役割にはできない）', async () => {
    orgMembership = { role: 'client' }

    const err = await clientUpdate({ userId: TARGET, spaceId: SPACE, role: 'viewer' }).catch((e: unknown) => e)
    expect(err).toMatchObject({ name: 'ToolUserError', status: 400 })
    expect(updated).toHaveLength(0)
  })

  it('組織 client の人は role=client でだけ更新できる', async () => {
    orgMembership = { role: 'client' }

    await clientUpdate({ userId: TARGET, spaceId: SPACE, role: 'client' })
    expect(updated).toHaveLength(1)
  })
})
