import { describe, it, expect, vi } from 'vitest'

/**
 * meeting_create / meeting_start / meeting_end / meeting_list / meeting_get の getOrgId・
 * 会議確認・再取得・参加者取得は、DBが断った理由を全部「見つかりません」等の一般Errorに
 * 潰し、cause も残さなかった。0件（PGRST116）は ToolUserError(404)、それ以外は一般Errorの
 * ままだが、どちらも元のDBエラーを cause に残す。
 */

const SPACE = '00000000-0000-0000-0000-000000000010'
const MEETING = '00000000-0000-0000-0000-000000000031'
const ORG = 'org-1'

type TableConfig = { error?: { code?: string; message: string } }
let tableConfig: Record<string, TableConfig> = {}

function chain(table: string) {
  const cfg = tableConfig[table]
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'insert', 'order', 'limit']) c[m] = () => c
  c.single = async () => {
    if (cfg?.error) return { data: null, error: cfg.error }
    if (table === 'meetings') return { data: { id: MEETING, title: 't', status: 'planned' }, error: null }
    return { data: { org_id: ORG }, error: null }
  }
  c.then = (resolve: (v: unknown) => void) => resolve(cfg?.error ? { data: null, error: cfg.error } : { data: [], error: null })
  return c
}

vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => chain(table),
    rpc: async () => ({ data: {}, error: null }),
  }),
}))
vi.mock('../auth/helpers.js', () => ({ checkAuth: async () => ({ ctx: {} }) }))
vi.mock('../config.js', () => ({ getAuthContext: () => ({ userId: 'actor-1' }) }))
vi.mock('../auth/scope.js', () => ({
  assertUsersAreSpaceMembers: async () => {},
  requireActorUserId: () => 'actor-1',
}))
vi.mock('../lib/appLinks.js', () => ({
  buildMinutesLink: () => 'https://example.test/link',
  withLink: (row: unknown) => row,
}))

const { meetingCreate, meetingStart, meetingList, meetingGet } = await import('./meetings.js')

function resetTableConfig() {
  tableConfig = {}
}

describe('meeting_create — getOrgId・作成の失敗', () => {
  it('spacesが0件（PGRST116）は ToolUserError(404)、causeにDBエラーを残す', async () => {
    resetTableConfig()
    tableConfig.spaces = { error: { code: 'PGRST116', message: 'no rows' } }

    const err = (await meetingCreate({ spaceId: SPACE, title: 't', participantIds: [] }).catch((e: unknown) => e)) as Error & {
      status?: number
      cause?: unknown
    }

    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
    expect(err.cause).toEqual(tableConfig.spaces.error)
  })

  it('meetingsの見覚えのない理由は一般のErrorのまま、causeにDBエラーを残す', async () => {
    resetTableConfig()
    tableConfig.meetings = { error: { code: '42501', message: 'permission denied for table meetings' } }

    const err = (await meetingCreate({ spaceId: SPACE, title: 't', participantIds: [] }).catch((e: unknown) => e)) as Error & {
      cause?: unknown
    }

    expect(err).not.toMatchObject({ name: 'ToolUserError' })
    expect(err.message).not.toContain('permission denied')
    expect(err.cause).toEqual(tableConfig.meetings.error)
  })
})

describe('meeting_start — 会議確認・再取得', () => {
  it('会議確認が0件（PGRST116）は ToolUserError(404)、causeにDBエラーを残す', async () => {
    resetTableConfig()
    tableConfig.meetings = { error: { code: 'PGRST116', message: 'no rows' } }

    const err = (await meetingStart({ spaceId: SPACE, meetingId: MEETING }).catch((e: unknown) => e)) as Error & {
      status?: number
      cause?: unknown
    }

    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
    expect(err.cause).toEqual(tableConfig.meetings.error)
  })
})

describe('meeting_list / meeting_get — 見覚えのないDBの理由は生の文言を出さない', () => {
  it('meeting_list: 一覧の取得に失敗', async () => {
    resetTableConfig()
    tableConfig.meetings = { error: { code: '42501', message: 'permission denied for table meetings' } }

    const err = (await meetingList({ spaceId: SPACE, limit: 20 }).catch((e: unknown) => e)) as Error & { cause?: unknown }

    expect(err.message).not.toContain('permission denied')
    expect(err.cause).toEqual(tableConfig.meetings.error)
  })

  it('meeting_get: 参加者の取得に失敗', async () => {
    resetTableConfig()
    tableConfig.meeting_participants = { error: { code: '42501', message: 'permission denied for table meeting_participants' } }

    const err = (await meetingGet({ spaceId: SPACE, meetingId: MEETING }).catch((e: unknown) => e)) as Error & { cause?: unknown }

    expect(err.message).not.toContain('permission denied')
    expect(err.cause).toEqual(tableConfig.meeting_participants.error)
  })
})
