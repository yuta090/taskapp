import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * assertInSpace / assertUsersInSpaceOrg / assertUsersAreSpaceMembers / assertInvitesAreInSpace
 * — CLI/MCP の道具が service role で読み書きする前に、引数で受け取った ID が渡された space
 * のものかを確かめる共通関数。
 */

let selectResponse: { data: unknown; error: unknown } = { data: null, error: null }
let spaceResponse: { data: unknown; error: unknown } = { data: { org_id: 'org-1' }, error: null }
let membershipsResponse: { data: unknown; error: unknown } = { data: [], error: null }
let spaceMembershipsResponse: { data: unknown; error: unknown } = { data: [], error: null }
let invitesResponse: { data: unknown; error: unknown } = { data: [], error: null }

const calls: Array<{ table: string; eq: Array<[string, unknown]> }> = []

function chain(table: string, response: { data: unknown; error: unknown }) {
  const record: { table: string; eq: Array<[string, unknown]> } = { table, eq: [] }
  calls.push(record)
  const obj: Record<string, unknown> = {
    select: () => obj,
    eq: (col: string, val: unknown) => {
      record.eq.push([col, val])
      return obj
    },
    in: (col: string, vals: unknown) => {
      record.eq.push([col, vals])
      return obj
    },
    is: (col: string, val: unknown) => {
      record.eq.push([col, val])
      return obj
    },
    gt: (col: string, val: unknown) => {
      record.eq.push([col, val])
      return obj
    },
    maybeSingle: async () => response,
    single: async () => response,
    // .in(...) の結果は .single()/.maybeSingle() を挟まず直接 await されるため、thenable にする
    then: (resolve: (v: unknown) => void) => resolve(response),
  }
  return obj
}

vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      if (table === 'spaces') return chain(table, spaceResponse)
      if (table === 'org_memberships') return chain(table, membershipsResponse)
      if (table === 'space_memberships') return chain(table, spaceMembershipsResponse)
      if (table === 'invites') return chain(table, invitesResponse)
      return chain(table, selectResponse)
    },
  }),
}))

const { assertInSpace, assertUsersInSpaceOrg, assertUsersAreSpaceMembers, assertInvitesAreInSpace } =
  await import('./scope.js')

const SPACE = '00000000-0000-0000-0000-000000000010'
const OTHER_SPACE = '00000000-0000-0000-0000-000000000099'
const ID = '00000000-0000-0000-0000-000000000001'

beforeEach(() => {
  calls.length = 0
  selectResponse = { data: { id: ID }, error: null }
  spaceResponse = { data: { org_id: 'org-1' }, error: null }
  membershipsResponse = { data: [], error: null }
  spaceMembershipsResponse = { data: [], error: null }
  invitesResponse = { data: [], error: null }
})

describe('assertInSpace', () => {
  it('同じ space の行があれば何も投げない', async () => {
    await expect(assertInSpace('wiki_pages', ID, SPACE)).resolves.toBeUndefined()
  })

  it('行が無い（別の space・存在しない）と ToolUserError(404) を投げる', async () => {
    selectResponse = { data: null, error: null }

    const err = await assertInSpace('wiki_pages', ID, OTHER_SPACE).catch((e: unknown) => e)
    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
  })

  it('渡した notFoundMessage をそのまま使う', async () => {
    selectResponse = { data: null, error: null }

    const err = await assertInSpace('wiki_pages', ID, OTHER_SPACE, '紐づけるWikiページが見つかりません').catch(
      (e: unknown) => e
    )
    expect((err as Error).message).toBe('紐づけるWikiページが見つかりません')
  })

  it('id と space_id の両方で絞り込む', async () => {
    await assertInSpace('wiki_pages', ID, SPACE)

    const call = calls.find((c) => c.table === 'wiki_pages')
    expect(call?.eq).toContainEqual(['id', ID])
    expect(call?.eq).toContainEqual(['space_id', SPACE])
  })

  it('DBエラーは中身を出さない汎用エラーのまま（ToolUserErrorにしない）', async () => {
    selectResponse = { data: null, error: { message: 'db down' } }

    const err = await assertInSpace('wiki_pages', ID, SPACE).catch((e: unknown) => e)
    expect((err as Error).name).not.toBe('ToolUserError')
  })
})

describe('assertUsersInSpaceOrg', () => {
  it('全員が space の組織のメンバーなら、役割つきの Map を返す', async () => {
    membershipsResponse = {
      data: [
        { user_id: 'u1', role: 'client' },
        { user_id: 'u2', role: 'member' },
      ],
      error: null,
    }

    const result = await assertUsersInSpaceOrg(['u1', 'u2'], SPACE)
    expect(result.get('u1')).toEqual({ role: 'client' })
    expect(result.get('u2')).toEqual({ role: 'member' })
  })

  it('1人でも組織外なら ToolUserError(404) を投げる', async () => {
    membershipsResponse = { data: [{ user_id: 'u1', role: 'client' }], error: null }

    const err = await assertUsersInSpaceOrg(['u1', 'u2'], SPACE).catch((e: unknown) => e)
    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
  })

  it('空配列なら何も確認せず空のMapを返す', async () => {
    const result = await assertUsersInSpaceOrg([], SPACE)
    expect(result.size).toBe(0)
    expect(calls).toHaveLength(0)
  })

  it('org_memberships を space の組織(org_id)で絞り込む', async () => {
    membershipsResponse = { data: [{ user_id: 'u1', role: 'client' }], error: null }

    await assertUsersInSpaceOrg(['u1'], SPACE)

    const call = calls.find((c) => c.table === 'org_memberships')
    expect(call?.eq).toContainEqual(['org_id', 'org-1'])
  })
})

describe('assertUsersAreSpaceMembers', () => {
  it('全員が space のメンバーなら何も投げない', async () => {
    spaceMembershipsResponse = { data: [{ user_id: 'u1' }, { user_id: 'u2' }], error: null }

    await expect(assertUsersAreSpaceMembers(['u1', 'u2'], SPACE)).resolves.toBeUndefined()
  })

  it('1人でも space 外なら ToolUserError(404) を投げる', async () => {
    spaceMembershipsResponse = { data: [{ user_id: 'u1' }], error: null }

    const err = await assertUsersAreSpaceMembers(['u1', 'u2'], SPACE).catch((e: unknown) => e)
    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
  })

  it('空配列なら何も確認しない', async () => {
    await assertUsersAreSpaceMembers([], SPACE)
    expect(calls).toHaveLength(0)
  })

  it('space_memberships を space_id で絞り込む', async () => {
    spaceMembershipsResponse = { data: [{ user_id: 'u1' }], error: null }

    await assertUsersAreSpaceMembers(['u1'], SPACE)

    const call = calls.find((c) => c.table === 'space_memberships')
    expect(call?.eq).toContainEqual(['space_id', SPACE])
  })
})

describe('assertInvitesAreInSpace', () => {
  it('未受諾・期限内の招待なら何も投げない', async () => {
    invitesResponse = { data: [{ id: 'inv-1' }], error: null }

    await expect(assertInvitesAreInSpace(['inv-1'], SPACE)).resolves.toBeUndefined()
  })

  it('見つからない招待（別space・受諾済み・期限切れ）があれば ToolUserError(404) を投げる', async () => {
    invitesResponse = { data: [], error: null }

    const err = await assertInvitesAreInSpace(['inv-1'], SPACE).catch((e: unknown) => e)
    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
  })

  it('空配列なら何も確認しない', async () => {
    await assertInvitesAreInSpace([], SPACE)
    expect(calls).toHaveLength(0)
  })

  it('space_id・未受諾(accepted_at is null)・期限内(expires_at > now)で絞り込む', async () => {
    invitesResponse = { data: [{ id: 'inv-1' }], error: null }

    await assertInvitesAreInSpace(['inv-1'], SPACE)

    const call = calls.find((c) => c.table === 'invites')
    expect(call?.eq).toContainEqual(['space_id', SPACE])
    expect(call?.eq).toContainEqual(['accepted_at', null])
    expect(call?.eq[2]?.[0]).toBe('expires_at')
  })
})
