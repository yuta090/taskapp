import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * CLI・API の返り値に `link`（画面で開く URL）が本当に入っているかを見る。
 *
 * これまで URL を組み立てる関数（`lib/appLinks.ts`）だけを試していて、
 * **道具の返り値に載っているか**を確かめていなかった。載せ忘れても気づけない。
 */

const ORG_ID = 'org-1'
const SPACE_ID = '00000000-0000-0000-0000-0000000000aa'

const WIKI_ROWS = [{ id: 'p-1', title: 'ページ1' }]
const MEETING_ROWS = [{ id: 'm-1', title: '会議1' }]
const TASK_ROWS = [{ id: 't-1', title: 'タスク1', short_id: 42, org_id: ORG_ID, space_id: SPACE_ID }]

/** 一覧用: select().eq().eq().order().limit() / range() のどれで終わっても行を返す */
function listChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {}
  const step = () => chain
  for (const key of ['select', 'eq', 'order', 'in', 'is', 'not', 'or', 'gte', 'lte', 'neq']) {
    chain[key] = step
  }
  chain.limit = async () => ({ data: rows, error: null })
  chain.range = async () => ({ data: rows, error: null })
  chain.single = async () => ({ data: rows[0], error: null })
  chain.then = undefined
  return chain
}

let tables: Record<string, unknown> = {}

vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({
    from: (table: string) =>
      table === 'spaces'
        ? { select: () => ({ eq: () => ({ single: async () => ({ data: { org_id: ORG_ID }, error: null }) }) }) }
        : (tables[table] ?? listChain([])),
  }),
}))
vi.mock('../auth/helpers.js', () => ({ checkAuth: async () => ({ ctx: {}, role: 'admin' }) }))
vi.mock('../auth/scope.js', () => ({ assertInSpace: async () => {} }))
// tasks.ts は helpers.js ではなく自前の checkAuth（authorizeAndLog）を使う
vi.mock('../auth/index.js', () => ({
  authorizeAndLog: async () => ({ allowed: true, role: 'admin' }),
}))
vi.mock('../config.js', () => ({
  config: { actorId: 'user-1' },
  getAuthContext: () => ({ actorId: 'user-1', orgId: ORG_ID, scope: 'space', spaceId: SPACE_ID }),
}))

beforeEach(() => {
  tables = {
    wiki_pages: listChain(WIKI_ROWS),
    meetings: listChain(MEETING_ROWS),
    tasks: listChain(TASK_ROWS),
    meeting_participants: listChain([]),
    task_owners: listChain([]),
  }
})

describe('CLI/API の返り値に link が入る', () => {
  it('wiki_list', async () => {
    const { wikiList } = await import('./wiki.js')
    const pages = await wikiList({ spaceId: SPACE_ID, limit: 50 })
    expect(pages[0]).toMatchObject({ link: `/${ORG_ID}/project/${SPACE_ID}/wiki?page=p-1` })
  })

  it('wiki_get', async () => {
    const { wikiGet } = await import('./wiki.js')
    const page = await wikiGet({ spaceId: SPACE_ID, pageId: 'p-1' })
    expect(page).toMatchObject({ link: `/${ORG_ID}/project/${SPACE_ID}/wiki?page=p-1` })
  })

  it('meeting_list', async () => {
    const { meetingList } = await import('./meetings.js')
    const meetings = await meetingList({ spaceId: SPACE_ID, limit: 50 } as never)
    expect(meetings[0]).toMatchObject({ link: `/${ORG_ID}/project/${SPACE_ID}/meetings?meeting=m-1` })
  })

  it('task_list', async () => {
    const { taskList } = await import('./tasks.js')
    const tasks = await taskList({ spaceId: SPACE_ID, limit: 50, offset: 0 } as never)
    expect(tasks[0]).toMatchObject({ link: `/${ORG_ID}/project/${SPACE_ID}?task=t-1` })
  })
})

describe('CLI の表は先頭8列しか出さないので、並びを守る', () => {
  it('Wiki は link を先頭に置く', async () => {
    const { wikiList } = await import('./wiki.js')
    const pages = await wikiList({ spaceId: SPACE_ID, limit: 50 })
    expect(Object.keys(pages[0])[0]).toBe('link')
  })

  it('タスクは number を先頭に保ち、link は押し出さない位置に置く', async () => {
    const { taskList } = await import('./tasks.js')
    const tasks = await taskList({ spaceId: SPACE_ID, limit: 50, offset: 0 } as never)
    const keys = Object.keys(tasks[0])
    expect(keys[0]).toBe('number')
    expect(keys.indexOf('link')).toBeGreaterThan(7)
  })
})
