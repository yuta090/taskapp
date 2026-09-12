import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * task_update — wikiPageId で指定する Wiki ページは、同じ space のものに限る
 * （紐づける前に assertInSpace で確かめる）。
 */

const tasksUpdates: Record<string, unknown>[] = []
let wikiPageExistsInSpace = true

const tasksChain = {
  update: (payload: Record<string, unknown>) => {
    tasksUpdates.push(payload)
    return tasksChain
  },
  eq: () => tasksChain,
  select: () => tasksChain,
  single: async () => ({ data: { id: TASK }, error: null }),
}

const wikiPagesChain = {
  select: () => wikiPagesChain,
  eq: () => wikiPagesChain,
  maybeSingle: async () => ({ data: wikiPageExistsInSpace ? { id: WIKI_PAGE } : null, error: null }),
}

vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => (table === 'wiki_pages' ? wikiPagesChain : tasksChain),
  }),
}))
vi.mock('../config.js', () => ({
  config: { actorId: 'actor-1' },
  getAuthContext: () => ({ keyId: 'k', userId: 'actor-1', orgId: 'org-1', scope: 'org', allowedSpaceIds: null, allowedActions: ['read', 'write'] }),
}))
vi.mock('../auth/index.js', () => ({ authorizeAndLog: async () => ({ allowed: true, role: 'admin', reason: 'ok' }) }))

const { taskUpdate } = await import('./tasks.js')

const SPACE = '00000000-0000-0000-0000-000000000010'
const TASK = '00000000-0000-0000-0000-000000000001'
const WIKI_PAGE = '00000000-0000-0000-0000-00000000aaaa'

beforeEach(() => {
  tasksUpdates.length = 0
  wikiPageExistsInSpace = true
})

describe('task_update — wikiPageId は同じ space のページだけ紐づけられる', () => {
  it('同じ space のページなら更新する', async () => {
    await taskUpdate({ spaceId: SPACE, taskId: TASK, wikiPageId: WIKI_PAGE })

    expect(tasksUpdates[0]).toMatchObject({ wiki_page_id: WIKI_PAGE })
  })

  it('別の space のページ（または存在しない）なら、tasksを更新せずToolUserError(404)を投げる', async () => {
    wikiPageExistsInSpace = false

    const err = await taskUpdate({ spaceId: SPACE, taskId: TASK, wikiPageId: WIKI_PAGE }).catch((e: unknown) => e)

    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
    expect(tasksUpdates).toHaveLength(0)
  })

  it('wikiPageId を null にする(解除)ときは確認しない', async () => {
    await taskUpdate({ spaceId: SPACE, taskId: TASK, wikiPageId: null })

    expect(tasksUpdates[0]).toMatchObject({ wiki_page_id: null })
  })
})
