import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * client_list / client_get / client_update / client_add_to_space / client_invite_list /
 * client_invite_resend: 見覚えのないDBの理由は、生の文言を出さない一般のエラーにする。
 * .single() の0件（PGRST116）だけは「見つかりません」のToolUserError(404)にする。
 */

const SPACE = '00000000-0000-0000-0000-000000000010'
const USER = '00000000-0000-0000-0000-000000000001'
const INVITE = '00000000-0000-0000-0000-000000000002'

// テーブルごとに「このテーブルへの最終問い合わせをエラーにするか」を指定できるモック
type TableConfig = { error?: { code?: string; message: string } }
let tableConfig: Record<string, TableConfig> = {}

function chain(table: string) {
  const cfg = tableConfig[table]
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'is', 'gt', 'order', 'limit', 'in']) c[m] = () => c
  c.insert = () => c
  c.update = () => c
  c.maybeSingle = async () => (cfg?.error ? { data: null, error: cfg.error } : { data: null, error: null })
  c.single = async () => (cfg?.error ? { data: null, error: cfg.error } : { data: { id: 'row-1', role: 'client' }, error: null })
  c.then = (resolve: (v: unknown) => void) =>
    resolve(cfg?.error ? { data: null, error: cfg.error } : { data: [], error: null })
  return c
}

vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({ from: (table: string) => chain(table) }),
}))
vi.mock('../auth/helpers.js', () => ({
  checkAuth: async () => ({ ctx: { userId: 'actor-1' }, role: 'admin' }),
  checkAuthOrg: async () => ({ ctx: { orgId: 'org-1', userId: 'actor-1' } }),
}))
vi.mock('../auth/scope.js', () => ({
  assertUsersInSpaceOrg: async () => new Map([[USER, { role: 'client' }]]),
}))

const { clientList, clientGet, clientUpdate, clientAddToSpace, clientInviteList, clientInviteResend } = await import(
  './clients.js'
)

beforeEach(() => {
  tableConfig = {}
})

describe('client_list — 見覚えのないDBの理由は生の文言を出さない', () => {
  it('メンバー一覧の取得に失敗', async () => {
    tableConfig = { org_memberships: { error: { code: '42501', message: 'permission denied for table org_memberships' } } }

    const err = await clientList({ includeInvites: false }).catch((e: unknown) => e)

    expect((err as Error).message).not.toContain('permission denied')
  })

  it('招待一覧の取得に失敗', async () => {
    tableConfig = { invites: { error: { code: '42501', message: 'permission denied for table invites' } } }

    const err = await clientList({ includeInvites: true }).catch((e: unknown) => e)

    expect((err as Error).message).not.toContain('permission denied')
  })
})

describe('client_get — 見つからない場合とそれ以外のDBの理由', () => {
  it('org_membershipsが0件（PGRST116）なら ToolUserError(404)', async () => {
    tableConfig = { org_memberships: { error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } } }

    const err = await clientGet({ userId: USER }).catch((e: unknown) => e)

    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
    expect((err as Error).message).not.toContain('JSON object requested')
  })

  it('space_membershipsの取得失敗は、生の文言を出さない一般のエラー', async () => {
    tableConfig = { space_memberships: { error: { code: '42501', message: 'permission denied for table space_memberships' } } }

    const err = await clientGet({ userId: USER }).catch((e: unknown) => e)

    expect(err).not.toMatchObject({ name: 'ToolUserError' })
    expect((err as Error).message).not.toContain('permission denied')
  })
})

describe('client_update — 見覚えのないDBの理由は生の文言を出さない', () => {
  it('更新に失敗', async () => {
    tableConfig = { space_memberships: { error: { code: '42501', message: 'permission denied for table space_memberships' } } }

    const err = await clientUpdate({ userId: USER, spaceId: SPACE, role: 'client' }).catch((e: unknown) => e)

    expect((err as Error).message).not.toContain('permission denied')
  })
})

describe('client_add_to_space — 見覚えのないDBの理由は生の文言を出さない', () => {
  it('追加に失敗', async () => {
    tableConfig = { space_memberships: { error: { code: '42501', message: 'permission denied for table space_memberships' } } }

    const err = await clientAddToSpace({ userId: USER, spaceId: SPACE, role: 'client' }).catch((e: unknown) => e)

    expect((err as Error).message).not.toContain('permission denied')
  })
})

describe('client_invite_list — 見覚えのないDBの理由は生の文言を出さない', () => {
  it('招待一覧の取得に失敗', async () => {
    tableConfig = { invites: { error: { code: '42501', message: 'permission denied for table invites' } } }

    const err = await clientInviteList({ status: 'pending', role: 'client' }).catch((e: unknown) => e)

    expect((err as Error).message).not.toContain('permission denied')
  })
})

describe('client_invite_resend — 見覚えのないDBの理由は生の文言を出さない', () => {
  it('再送に失敗', async () => {
    tableConfig = { invites: { error: { code: '42501', message: 'permission denied for table invites' } } }

    const err = await clientInviteResend({ inviteId: INVITE, expiresInDays: 7 }).catch((e: unknown) => e)

    expect((err as Error).message).not.toContain('permission denied')
  })
})
