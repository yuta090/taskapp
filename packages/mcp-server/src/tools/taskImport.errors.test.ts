import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * task_import の下ごしらえ（既存タスクの確認・ユーザー情報の取得・マイルストーンの取得）は、
 * 見覚えのないDBの理由を、生の文言を出さない一般のエラーにする。
 */

const SPACE = '00000000-0000-0000-0000-000000000010'
// assignee をメールにして needEmails=true にし、listUsers の経路を必ず通す
const CSV = 'title,assignee\nタスクA,someone@example.com\n'

let tasksError: { code: string; message: string } | null = null
let listUsersError: { code: string; message: string } | null = null
let milestonesError: { code: string; message: string } | null = null

function chain(table: string) {
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order', 'range', 'in']) c[m] = () => c
  c.single = async () => ({ data: { org_id: 'org-1' }, error: null })
  c.then = (resolve: (v: unknown) => void) => {
    if (table === 'tasks') return resolve({ data: [], error: tasksError })
    if (table === 'milestones') return resolve({ data: [], error: milestonesError })
    return resolve({ data: [], error: null })
  }
  return c
}

vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => chain(table),
    auth: { admin: { listUsers: async () => ({ data: { users: [] }, error: listUsersError }) } },
  }),
}))
vi.mock('../config.js', () => ({
  config: { actorId: 'actor-1' },
  getAuthContext: () => ({ keyId: 'k', userId: 'actor-1', orgId: 'org-1', scope: 'org', allowedSpaceIds: null, allowedActions: ['read', 'write', 'bulk'] }),
}))
vi.mock('../auth/index.js', () => ({ authorizeAndLog: async () => ({ allowed: true, role: 'admin', reason: 'ok' }) }))

const { taskImport } = await import('./taskImport.js')

beforeEach(() => {
  tasksError = null
  listUsersError = null
  milestonesError = null
})

describe('task_import — 見覚えのないDBの理由は生の文言を出さない', () => {
  it('既存タスクの確認に失敗', async () => {
    tasksError = { code: '42501', message: 'permission denied for table tasks' }

    const err = await taskImport({ spaceId: SPACE, csv: CSV, dryRun: true }).catch((e: unknown) => e)

    expect((err as Error).message).not.toContain('permission denied')
  })

  it('ユーザー情報(listUsers)の取得に失敗', async () => {
    listUsersError = { code: 'unknown', message: 'auth admin listUsers failed unexpectedly' }

    const err = await taskImport({ spaceId: SPACE, csv: CSV, dryRun: true }).catch((e: unknown) => e)

    expect((err as Error).message).not.toContain('unexpectedly')
  })

  it('マイルストーンの取得に失敗', async () => {
    milestonesError = { code: '42501', message: 'permission denied for table milestones' }

    const err = await taskImport({ spaceId: SPACE, csv: CSV, dryRun: true }).catch((e: unknown) => e)

    expect((err as Error).message).not.toContain('permission denied')
  })
})
