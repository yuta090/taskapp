import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * vote_show — 投票の詳細。押した人・選んだもの・メモと、履歴（cast/change/retract）を、
 * 名前（profiles.display_name）付きで返す。メールアドレスは返さない。
 */

const SPACE = '00000000-0000-0000-0000-000000000010'
const POLL = '00000000-0000-0000-0000-000000000f01'
const U1 = '00000000-0000-0000-0000-000000000101'
const U2 = '00000000-0000-0000-0000-000000000102'

let pollExists = true
let voteRows: Array<{ user_id: string; choice: string; memo: string; updated_at: string }> = []
let eventRows: Array<{ id: number; user_id: string; action: string; choice: string | null; memo: string; created_at: string }> = []
let profileRows: Array<{ id: string; display_name: string | null }> = []

function makeChain(opts: { then?: unknown; single?: unknown; maybeSingle?: unknown }) {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === 'then' && opts.then !== undefined) return (resolve: (v: unknown) => void) => resolve(opts.then)
        if (prop === 'single' && opts.single !== undefined) return async () => opts.single
        if (prop === 'maybeSingle' && opts.maybeSingle !== undefined) return async () => opts.maybeSingle
        return () => proxy
      },
    }
  )
  return proxy
}

vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      if (table === 'doc_polls')
        return makeChain({
          maybeSingle: { data: pollExists ? { id: POLL } : null, error: null },
          single: { data: { id: POLL, reason_required: 'ng_hold' }, error: null },
        })
      if (table === 'doc_votes') return makeChain({ then: { data: voteRows, error: null } })
      if (table === 'doc_vote_events') return makeChain({ then: { data: eventRows, error: null } })
      if (table === 'profiles') return makeChain({ then: { data: profileRows, error: null } })
      throw new Error(`unexpected table: ${table}`)
    },
  }),
}))
vi.mock('../auth/helpers.js', () => ({ checkAuth: async () => ({ ctx: {}, role: 'admin' }) }))

const { voteShow } = await import('./votes.js')

beforeEach(() => {
  pollExists = true
  voteRows = []
  eventRows = []
  profileRows = []
})

describe('vote_show — 押した人・メモ・履歴を名前付きで返す', () => {
  it('票と履歴に display_name を添える', async () => {
    voteRows = [
      { user_id: U1, choice: 'ok', memo: '', updated_at: '2026-09-26T01:00:00Z' },
      { user_id: U2, choice: 'ng', memo: '心配な点がある', updated_at: '2026-09-26T02:00:00Z' },
    ]
    eventRows = [
      { id: 1, user_id: U1, action: 'cast', choice: 'ok', memo: '', created_at: '2026-09-26T00:59:00Z' },
      { id: 2, user_id: U2, action: 'cast', choice: 'ng', memo: '心配な点がある', created_at: '2026-09-26T01:59:00Z' },
    ]
    profileRows = [
      { id: U1, display_name: '田中' },
      { id: U2, display_name: null },
    ]

    const result = await voteShow({ spaceId: SPACE, pollId: POLL })

    expect(result.pollId).toBe(POLL)
    expect(result.reasonRequired).toBe('ng_hold')
    expect(result.votes).toEqual([
      { userId: U1, displayName: '田中', choice: 'ok', memo: '', updatedAt: '2026-09-26T01:00:00Z' },
      { userId: U2, displayName: '(名前未設定)', choice: 'ng', memo: '心配な点がある', updatedAt: '2026-09-26T02:00:00Z' },
    ])
    expect(result.history).toEqual([
      { userId: U1, displayName: '田中', action: 'cast', choice: 'ok', memo: '', createdAt: '2026-09-26T00:59:00Z' },
      { userId: U2, displayName: '(名前未設定)', action: 'cast', choice: 'ng', memo: '心配な点がある', createdAt: '2026-09-26T01:59:00Z' },
    ])
  })

  it('profiles に無い(消えた)利用者は不明の名前にする', async () => {
    voteRows = [{ user_id: U1, choice: 'ok', memo: '', updated_at: '2026-09-26T01:00:00Z' }]
    profileRows = []

    const result = await voteShow({ spaceId: SPACE, pollId: POLL })

    expect(result.votes[0].displayName).toBe('(不明)')
  })

  it('別の space の投票なら ToolUserError(404)', async () => {
    pollExists = false

    const err = await voteShow({ spaceId: SPACE, pollId: POLL }).catch((e: unknown) => e)

    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
  })

  it('メールアドレスは返さない', async () => {
    voteRows = [{ user_id: U1, choice: 'ok', memo: '', updated_at: '2026-09-26T01:00:00Z' }]
    profileRows = [{ id: U1, display_name: '田中' }]

    const result = await voteShow({ spaceId: SPACE, pollId: POLL })

    expect(JSON.stringify(result)).not.toMatch(/@/)
  })
})
