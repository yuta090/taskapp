import { describe, it, expect, vi } from 'vitest'

/**
 * PR2: 構造(親子・マイルストーン・ピン留め)。wiki_list の select に新列を足し、
 * wiki_update から parentPageId/milestoneId/pinned を DB update に渡せることを確かめる。
 */
const updates: Record<string, unknown>[] = []
let listSelectArg = ''

const wikiPagesChain = {
  select: (arg: string) => {
    listSelectArg = arg
    return wikiPagesChain
  },
  eq: () => wikiPagesChain,
  order: () => wikiPagesChain,
  limit: async () => ({ data: [], error: null }),
  update: (payload: Record<string, unknown>) => {
    updates.push(payload)
    return {
      eq: () => ({
        eq: () => ({
          eq: () => ({
            select: () => ({
              single: async () => ({ data: { id: 'p-1', title: 'ページ' }, error: null }),
            }),
          }),
        }),
      }),
    }
  },
}

vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({
    from: (table: string) =>
      table === 'spaces'
        ? { select: () => ({ eq: () => ({ single: async () => ({ data: { org_id: 'org-1' }, error: null }) }) }) }
        : table === 'wiki_pages'
          ? wikiPagesChain
          : { insert: () => ({ error: null }) },
  }),
}))
vi.mock('../auth/helpers.js', () => ({ checkAuth: async () => ({ ctx: {} }) }))

const { wikiList, wikiUpdate } = await import('./wiki.js')

describe('wiki_list（構造列）', () => {
  it('select に親子/マイルストーン/ピン留め/並び順の列を含める', async () => {
    await wikiList({ spaceId: '00000000-0000-0000-0000-000000000010', limit: 50 })
    expect(listSelectArg).toContain('parent_page_id')
    expect(listSelectArg).toContain('milestone_id')
    expect(listSelectArg).toContain('pinned_at')
    expect(listSelectArg).toContain('sort_order')
  })
})

describe('wiki_update（構造列）', () => {
  it('parentPageId/milestoneId を DB update に渡す', async () => {
    updates.length = 0
    await wikiUpdate({
      spaceId: '00000000-0000-0000-0000-000000000010',
      pageId: 'p-1',
      parentPageId: 'parent-1',
      milestoneId: 'milestone-1',
    })
    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({ parent_page_id: 'parent-1', milestone_id: 'milestone-1' })
  })

  it('parentPageId: null で親を外せる', async () => {
    updates.length = 0
    await wikiUpdate({ spaceId: '00000000-0000-0000-0000-000000000010', pageId: 'p-1', parentPageId: null })
    expect(updates[0]).toMatchObject({ parent_page_id: null })
  })

  it('pinned: true で pinned_at に時刻を入れる', async () => {
    updates.length = 0
    await wikiUpdate({ spaceId: '00000000-0000-0000-0000-000000000010', pageId: 'p-1', pinned: true })
    expect(typeof updates[0].pinned_at).toBe('string')
  })

  it('pinned: false で pinned_at を null にする', async () => {
    updates.length = 0
    await wikiUpdate({ spaceId: '00000000-0000-0000-0000-000000000010', pageId: 'p-1', pinned: false })
    expect(updates[0]).toMatchObject({ pinned_at: null })
  })

  it('parentPageId/milestoneId/pinned を渡さなければ update に含めない', async () => {
    updates.length = 0
    await wikiUpdate({ spaceId: '00000000-0000-0000-0000-000000000010', pageId: 'p-1', title: '新タイトル' })
    expect(updates[0]).not.toHaveProperty('parent_page_id')
    expect(updates[0]).not.toHaveProperty('milestone_id')
    expect(updates[0]).not.toHaveProperty('pinned_at')
  })
})
