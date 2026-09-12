import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * task_import は、見覚えのないDBの理由を、次にできることが分かるヒント
 * （重複・必須項目の不足・つながりの不整合）があればそれを、無ければ決まった
 * 一般のメッセージを返す（生の文言は出さない）。
 */

type Row = Record<string, unknown>
const db: Record<string, Row[]> = {
  spaces: [{ id: 'space-1', org_id: 'org-1' }],
  tasks: [],
  space_memberships: [{ space_id: 'space-1', user_id: 'u-taka', role: 'owner' }],
  profiles: [{ id: 'u-taka', display_name: '高橋' }],
  milestones: [],
}

let tableErrors: Record<string, { code?: string; message: string }> = {}

function query(table: string) {
  let rows = db[table] ?? []
  const q: Record<string, unknown> = {}
  const chain = () => q
  q.select = chain
  q.order = chain
  q.eq = (col: string, v: unknown) => { rows = rows.filter((r) => r[col] === v); return q }
  q.in = (col: string, vs: unknown[]) => { rows = rows.filter((r) => vs.includes(r[col])); return q }
  q.range = (from: number, to: number) => { rows = rows.slice(from, to + 1); return q }
  q.single = async () => {
    if (tableErrors[table]) return { data: null, error: tableErrors[table] }
    return { data: rows[0] ?? null, error: rows[0] ? null : { message: 'not found' } }
  }
  q.then = (resolve: (v: unknown) => void) => {
    if (tableErrors[table]) return resolve({ data: null, error: tableErrors[table] })
    return resolve({ data: rows, error: null })
  }
  q.insert = (payload: Row[]) => {
    if (tableErrors[table]) {
      return {
        select: async () => ({ data: null, error: tableErrors[table] }),
        then: (r: (v: unknown) => void) => r({ data: null, error: tableErrors[table] }),
      }
    }
    return {
      select: async () => ({ data: payload, error: null }),
      then: (r: (v: unknown) => void) => r({ data: payload, error: null }),
    }
  }
  return q
}

const listUsers = vi.fn(async () => ({ data: { users: [] }, error: null }))

vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({ from: query, auth: { admin: { listUsers } } }),
}))
vi.mock('../config.js', () => ({
  config: { actorId: 'actor-1' },
  getAuthContext: () => ({ keyId: 'k', userId: 'actor-1', orgId: 'org-1', scope: 'org', allowedSpaceIds: null, allowedActions: ['read', 'write', 'bulk'] }),
}))
vi.mock('../auth/index.js', () => ({
  authorizeAndLog: async () => ({ allowed: true, role: 'admin', reason: 'ok' }),
}))

const { taskImport } = await import('./taskImport.js')

beforeEach(() => { tableErrors = {} })

const CSV = 'title\n新規タスク\n'

describe('task_import — 見覚えのないDBの理由は一般のエラー', () => {
  it('メンバー一覧の取得に失敗', async () => {
    tableErrors = { space_memberships: { code: '42501', message: 'permission denied for table space_memberships' } }

    const err = await taskImport({ spaceId: 'space-1', csv: CSV, dryRun: true }).catch((e: unknown) => e)

    expect((err as Error).message).not.toContain('permission denied')
  })

  it('プロフィールの取得に失敗', async () => {
    tableErrors = { profiles: { code: '42501', message: 'permission denied for table profiles' } }

    const err = await taskImport({ spaceId: 'space-1', csv: CSV, dryRun: true }).catch((e: unknown) => e)

    expect((err as Error).message).not.toContain('permission denied')
  })

  it('担当者の登録に失敗', async () => {
    const csvWithOwner = 'title,client_owners\n新規タスク,高橋\n'
    tableErrors = { task_owners: { code: '42501', message: 'permission denied for table task_owners' } }

    const err = await taskImport({ spaceId: 'space-1', csv: csvWithOwner, dryRun: false }).catch((e: unknown) => e)

    expect((err as Error).message).not.toContain('permission denied')
  })
})
