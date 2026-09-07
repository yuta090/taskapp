import { describe, it, expect, vi } from 'vitest'

/** task_update が wikiPageId を wiki_page_id として書くこと（CLI からタスクと Wiki を紐づける経路）。 */
const updates: Record<string, unknown>[] = []
const chain = {
  update: (payload: Record<string, unknown>) => { updates.push(payload); return chain },
  eq: () => chain,
  select: () => chain,
  single: async () => ({ data: { id: 't-1' }, error: null }),
}
vi.mock('../supabase/client.js', () => ({ getSupabaseClient: () => ({ from: () => chain }) }))
vi.mock('../config.js', () => ({
  config: { actorId: 'actor-1' },
  getAuthContext: () => ({ keyId: 'k', userId: 'actor-1', orgId: 'org-1', scope: 'org', allowedSpaceIds: null, allowedActions: ['read', 'write'] }),
}))
vi.mock('../auth/index.js', () => ({ authorizeAndLog: async () => ({ allowed: true, role: 'admin', reason: 'ok' }) }))

const { taskUpdate } = await import('./tasks.js')

describe('task_update wikiPageId', () => {
  it('wikiPageId を wiki_page_id として更新し、null で解除できる', async () => {
    await taskUpdate({ spaceId: '00000000-0000-0000-0000-000000000010', taskId: '00000000-0000-0000-0000-000000000001', wikiPageId: '00000000-0000-0000-0000-00000000aaaa' })
    expect(updates[0]).toMatchObject({ wiki_page_id: '00000000-0000-0000-0000-00000000aaaa' })
    await taskUpdate({ spaceId: '00000000-0000-0000-0000-000000000010', taskId: '00000000-0000-0000-0000-000000000001', wikiPageId: null })
    expect(updates[1]).toMatchObject({ wiki_page_id: null })
  })
})
