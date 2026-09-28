import { describe, it, expect, vi } from 'vitest'

/**
 * vote_list / vote_show の getOrgId・Wikiページ/会議取得・投票取得は、DBが断った理由を
 * 全部「見つかりません」等の一般Errorに潰し、cause も残さなかった。0件（PGRST116）は
 * ToolUserError(404)、それ以外は一般Errorのままだが、どちらも元のDBエラーを cause に残す。
 */

const SPACE = '00000000-0000-0000-0000-000000000010'
const WIKI = '00000000-0000-0000-0000-000000000021'
const MEETING = '00000000-0000-0000-0000-000000000022'
const POLL = '00000000-0000-0000-0000-000000000023'
const ORG = 'org-1'

type TableConfig = { error?: { code?: string; message: string } }
let tableConfig: Record<string, TableConfig> = {}

function chain(table: string) {
  const cfg = tableConfig[table]
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order', 'in']) c[m] = () => c
  c.single = async () => {
    if (cfg?.error) return { data: null, error: cfg.error }
    if (table === 'wiki_pages') return { data: { body: [] }, error: null }
    if (table === 'meetings') return { data: { minutes_md: '' }, error: null }
    if (table === 'doc_polls') return { data: { id: POLL, reason_required: 'none' }, error: null }
    return { data: { org_id: ORG }, error: null }
  }
  c.then = (resolve: (v: unknown) => void) => resolve(cfg?.error ? { data: null, error: cfg.error } : { data: [], error: null })
  return c
}

vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({ from: (table: string) => chain(table) }),
}))
vi.mock('../auth/helpers.js', () => ({ checkAuth: async () => ({ ctx: {} }) }))
vi.mock('../auth/scope.js', () => ({
  assertInSpace: async () => {},
  requireActorUserId: () => 'actor-1',
}))

const { voteList, voteShow } = await import('./votes.js')

function resetTableConfig() {
  tableConfig = {}
}

describe('vote_list — getOrgId の断り方', () => {
  it('spacesが0件（PGRST116）は ToolUserError(404)、causeにDBエラーを残す', async () => {
    resetTableConfig()
    tableConfig.spaces = { error: { code: 'PGRST116', message: 'no rows' } }

    const err = (await voteList({ spaceId: SPACE, wikiPageId: WIKI }).catch((e: unknown) => e)) as Error & {
      status?: number
      cause?: unknown
    }

    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
    expect(err.cause).toEqual(tableConfig.spaces.error)
  })

  it('spacesの見覚えのない理由は一般のErrorのまま、causeにDBエラーを残す', async () => {
    resetTableConfig()
    tableConfig.spaces = { error: { code: '42501', message: 'permission denied for table spaces' } }

    const err = (await voteList({ spaceId: SPACE, wikiPageId: WIKI }).catch((e: unknown) => e)) as Error & { cause?: unknown }

    expect(err).not.toMatchObject({ name: 'ToolUserError' })
    expect(err.message).not.toContain('permission denied')
    expect(err.cause).toEqual(tableConfig.spaces.error)
  })
})

describe('vote_list — Wikiページ本文の取得', () => {
  it('0件（PGRST116）は ToolUserError(404)、causeにDBエラーを残す', async () => {
    resetTableConfig()
    tableConfig.wiki_pages = { error: { code: 'PGRST116', message: 'no rows' } }

    const err = (await voteList({ spaceId: SPACE, wikiPageId: WIKI }).catch((e: unknown) => e)) as Error & {
      status?: number
      cause?: unknown
    }

    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
    expect(err.cause).toEqual(tableConfig.wiki_pages.error)
  })
})

describe('vote_list — 会議本文の取得', () => {
  it('見覚えのない理由は一般のErrorのまま、causeにDBエラーを残す', async () => {
    resetTableConfig()
    tableConfig.meetings = { error: { code: '42501', message: 'permission denied for table meetings' } }

    const err = (await voteList({ spaceId: SPACE, meetingId: MEETING }).catch((e: unknown) => e)) as Error & { cause?: unknown }

    expect(err).not.toMatchObject({ name: 'ToolUserError' })
    expect(err.message).not.toContain('permission denied')
    expect(err.cause).toEqual(tableConfig.meetings.error)
  })
})

describe('vote_list — 投票・票の取得', () => {
  it('doc_pollsの取得失敗は一般のErrorのまま、causeにDBエラーを残す', async () => {
    resetTableConfig()
    tableConfig.doc_polls = { error: { code: '42501', message: 'permission denied for table doc_polls' } }

    const err = (await voteList({ spaceId: SPACE, wikiPageId: WIKI }).catch((e: unknown) => e)) as Error & { cause?: unknown }

    expect(err.message).not.toContain('permission denied')
    expect(err.cause).toEqual(tableConfig.doc_polls.error)
  })
})

describe('vote_show — 投票・票・履歴の取得', () => {
  it('doc_pollsが0件（PGRST116）は ToolUserError(404)、causeにDBエラーを残す', async () => {
    resetTableConfig()
    tableConfig.doc_polls = { error: { code: 'PGRST116', message: 'no rows' } }

    const err = (await voteShow({ spaceId: SPACE, pollId: POLL }).catch((e: unknown) => e)) as Error & {
      status?: number
      cause?: unknown
    }

    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
    expect(err.cause).toEqual(tableConfig.doc_polls.error)
  })

  it('doc_votesの取得失敗は一般のErrorのまま、causeにDBエラーを残す', async () => {
    resetTableConfig()
    tableConfig.doc_votes = { error: { code: '42501', message: 'permission denied for table doc_votes' } }

    const err = (await voteShow({ spaceId: SPACE, pollId: POLL }).catch((e: unknown) => e)) as Error & { cause?: unknown }

    expect(err.message).not.toContain('permission denied')
    expect(err.cause).toEqual(tableConfig.doc_votes.error)
  })

  it('doc_vote_eventsの取得失敗は一般のErrorのまま、causeにDBエラーを残す', async () => {
    resetTableConfig()
    tableConfig.doc_vote_events = { error: { code: '42501', message: 'permission denied for table doc_vote_events' } }

    const err = (await voteShow({ spaceId: SPACE, pollId: POLL }).catch((e: unknown) => e)) as Error & { cause?: unknown }

    expect(err.message).not.toContain('permission denied')
    expect(err.cause).toEqual(tableConfig.doc_vote_events.error)
  })
})
