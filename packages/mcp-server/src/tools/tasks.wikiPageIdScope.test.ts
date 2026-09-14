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

// wikiPageId を渡すと、画面と同じ規則で type / decision_state も揃えるため、
// ページの tags（仕様書かどうか）と、いまの decision_state を読む
let wikiPageTags: string[] = []

const wikiPagesChain = {
  select: () => wikiPagesChain,
  eq: () => wikiPagesChain,
  maybeSingle: async () => ({ data: wikiPageExistsInSpace ? { id: WIKI_PAGE } : null, error: null }),
  single: async () => ({ data: { tags: wikiPageTags }, error: null }),
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
  wikiPageTags = []
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

/**
 * 画面（useTasks の specChangesForWikiLink）と同じ規則で、紐づけたときに
 * type / decision_state も揃える。揃えないと CLI から仕様書ページを紐づけても
 * 「決める札」にならず、「決まるまで完了できない」歯止めが効かない。
 */
describe('task_update — 紐づけたページの種類で決める札になる', () => {
  it('「仕様書」タグのページなら、決める札にして検討中を入れる', async () => {
    wikiPageTags = ['仕様書']
    await taskUpdate({ spaceId: SPACE, taskId: TASK, wikiPageId: WIKI_PAGE })
    expect(tasksUpdates[0]).toMatchObject({
      wiki_page_id: WIKI_PAGE,
      type: 'spec',
      decision_state: 'considering',
    })
  })

  it('タグ無し（参考資料）ならリンクだけで、完了を止めない', async () => {
    wikiPageTags = ['議事録']
    await taskUpdate({ spaceId: SPACE, taskId: TASK, wikiPageId: WIKI_PAGE })
    expect(tasksUpdates[0]).toMatchObject({ wiki_page_id: WIKI_PAGE })
    expect(tasksUpdates[0]).not.toHaveProperty('type')
    expect(tasksUpdates[0]).not.toHaveProperty('decision_state')
  })

  it('外すと、ふつうのタスクに戻す', async () => {
    await taskUpdate({ spaceId: SPACE, taskId: TASK, wikiPageId: null })
    expect(tasksUpdates[0]).toMatchObject({
      wiki_page_id: null,
      type: 'task',
      decision_state: null,
    })
  })
})
