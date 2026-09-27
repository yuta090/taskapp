import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * vote_list — Wikiページ・会議どちらか片方の docPoll を一覧にする。
 * 議題は本文（Wiki=BlockNote JSON・会議=Markdownの `<!--vote:…-->` 行）から拾う。
 * 仕様: docs/spec/DOC_VOTE_SPEC.md §3
 */

const SPACE = '00000000-0000-0000-0000-000000000010'
const ORG = '00000000-0000-0000-0000-0000000000aa'
const WIKI_PAGE = '00000000-0000-0000-0000-00000000aaaa'
const MEETING = '00000000-0000-0000-0000-000000000002'
const POLL1 = '00000000-0000-0000-0000-000000000f01'
const POLL2 = '00000000-0000-0000-0000-000000000f02'

let wikiPageExists = true
let wikiBody: unknown = []
let meetingExists = true
let minutesMd = ''
let pollRows: Array<{ id: string; reason_required: string }> = []
let voteRows: Array<{ poll_id: string; choice: string }> = []

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
      if (table === 'spaces') return makeChain({ single: { data: { org_id: ORG }, error: null } })
      if (table === 'wiki_pages')
        return makeChain({
          maybeSingle: { data: wikiPageExists ? { id: WIKI_PAGE } : null, error: null },
          single: { data: { body: wikiBody }, error: null },
        })
      if (table === 'meetings')
        return makeChain({
          maybeSingle: { data: meetingExists ? { id: MEETING } : null, error: null },
          single: { data: { minutes_md: minutesMd }, error: null },
        })
      if (table === 'doc_polls') return makeChain({ then: { data: pollRows, error: null } })
      if (table === 'doc_votes') return makeChain({ then: { data: voteRows, error: null } })
      throw new Error(`unexpected table: ${table}`)
    },
  }),
}))
vi.mock('../auth/helpers.js', () => ({ checkAuth: async () => ({ ctx: {}, role: 'admin' }) }))

const { voteList } = await import('./votes.js')

beforeEach(() => {
  wikiPageExists = true
  wikiBody = []
  meetingExists = true
  minutesMd = ''
  pollRows = []
  voteRows = []
})

describe('vote_list — wikiPageId / meetingId はどちらか片方だけ', () => {
  it('両方指定するとToolUserError(400)', async () => {
    const err = await voteList({ spaceId: SPACE, wikiPageId: WIKI_PAGE, meetingId: MEETING }).catch((e: unknown) => e)
    expect(err).toMatchObject({ name: 'ToolUserError', status: 400 })
  })

  it('どちらも指定しないとToolUserError(400)', async () => {
    const err = await voteList({ spaceId: SPACE }).catch((e: unknown) => e)
    expect(err).toMatchObject({ name: 'ToolUserError', status: 400 })
  })
})

describe('vote_list — Wikiページの投票（BlockNote JSON から議題を拾う）', () => {
  it('議題・理由必須・OK/NG/保留の人数を返す', async () => {
    wikiBody = [
      {
        type: 'docPoll',
        props: { pollId: POLL1, reasonRequired: 'none' },
        content: [{ type: 'text', text: '来月から新プランに移行してよいか' }],
      },
      {
        type: 'paragraph',
        content: [],
        children: [
          {
            type: 'docPoll',
            props: { pollId: POLL2, reasonRequired: 'ng_hold' },
            content: [{ type: 'text', text: '請求日を' }, { type: 'text', text: '25日に変える' }],
          },
        ],
      },
    ]
    pollRows = [
      { id: POLL1, reason_required: 'none' },
      { id: POLL2, reason_required: 'ng_hold' },
    ]
    voteRows = [
      { poll_id: POLL1, choice: 'ok' },
      { poll_id: POLL1, choice: 'ok' },
      { poll_id: POLL1, choice: 'ng' },
      { poll_id: POLL2, choice: 'hold' },
    ]

    const result = await voteList({ spaceId: SPACE, wikiPageId: WIKI_PAGE })

    expect(result).toEqual([
      { pollId: POLL1, topic: '来月から新プランに移行してよいか', reasonRequired: 'none', counts: { ok: 2, ng: 1, hold: 0 } },
      { pollId: POLL2, topic: '請求日を25日に変える', reasonRequired: 'ng_hold', counts: { ok: 0, ng: 0, hold: 1 } },
    ])
  })

  it('本文に無い投票（作り損ね）は議題が空文字', async () => {
    wikiBody = []
    pollRows = [{ id: POLL1, reason_required: 'none' }]
    voteRows = []

    const result = await voteList({ spaceId: SPACE, wikiPageId: WIKI_PAGE })

    expect(result).toEqual([{ pollId: POLL1, topic: '', reasonRequired: 'none', counts: { ok: 0, ng: 0, hold: 0 } }])
  })

  it('別の space のページなら ToolUserError(404)', async () => {
    wikiPageExists = false

    const err = await voteList({ spaceId: SPACE, wikiPageId: WIKI_PAGE }).catch((e: unknown) => e)

    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
  })

  it('投票が無いページは空配列', async () => {
    pollRows = []
    const result = await voteList({ spaceId: SPACE, wikiPageId: WIKI_PAGE })
    expect(result).toEqual([])
  })
})

describe('vote_list — 議事録の投票（Markdown の `<!--vote:…-->` 行から議題を拾う）', () => {
  it('理由必須(must)の行を reasonRequired=ng_hold として拾う', async () => {
    minutesMd = [
      '会議メモ',
      '<!--vote:00000000-0000-0000-0000-000000000f01-->予算を承認するか',
      '<!--vote:00000000-0000-0000-0000-000000000f02 must-->延期してよいか',
    ].join('\n')
    pollRows = [
      { id: '00000000-0000-0000-0000-000000000f01', reason_required: 'none' },
      { id: '00000000-0000-0000-0000-000000000f02', reason_required: 'ng_hold' },
    ]
    voteRows = []

    const result = await voteList({ spaceId: SPACE, meetingId: MEETING })

    expect(result).toEqual([
      { pollId: '00000000-0000-0000-0000-000000000f01', topic: '予算を承認するか', reasonRequired: 'none', counts: { ok: 0, ng: 0, hold: 0 } },
      { pollId: '00000000-0000-0000-0000-000000000f02', topic: '延期してよいか', reasonRequired: 'ng_hold', counts: { ok: 0, ng: 0, hold: 0 } },
    ])
  })

  it('別の space の会議なら ToolUserError(404)', async () => {
    meetingExists = false

    const err = await voteList({ spaceId: SPACE, meetingId: MEETING }).catch((e: unknown) => e)

    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
  })
})
