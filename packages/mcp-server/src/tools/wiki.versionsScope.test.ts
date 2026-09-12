import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * wiki_versions — wiki_page_versions には space_id の列が無いため、版を引く前に
 * wiki_pages がその space のものと確かめてから引く。
 */

let versionsResponse: { data: unknown; error: unknown } = { data: [], error: null }
let pageExistsInSpace = true

const wikiPagesChain = {
  select: () => wikiPagesChain,
  eq: () => wikiPagesChain,
  maybeSingle: async () => ({ data: pageExistsInSpace ? { id: PAGE } : null, error: null }),
}

const versionsCalls: Array<{ eq: Array<[string, unknown]> }> = []
function makeVersionsChain() {
  const record: { eq: Array<[string, unknown]> } = { eq: [] }
  versionsCalls.push(record)
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: (col: string, val: unknown) => {
      record.eq.push([col, val])
      return chain
    },
    order: () => chain,
    limit: async () => versionsResponse,
  }
  return chain
}

vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      if (table === 'spaces') {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: { org_id: 'org-1' }, error: null }) }) }) }
      }
      if (table === 'wiki_pages') return wikiPagesChain
      return makeVersionsChain()
    },
  }),
}))
vi.mock('../auth/helpers.js', () => ({ checkAuth: async () => ({ ctx: {} }) }))

const { wikiVersions } = await import('./wiki.js')

const SPACE = '00000000-0000-0000-0000-000000000010'
const PAGE = '00000000-0000-0000-0000-00000000aaaa'

beforeEach(() => {
  versionsCalls.length = 0
  versionsResponse = { data: [], error: null }
  pageExistsInSpace = true
})

describe('wiki_versions — ページが渡された space のものか確かめてから版を引く', () => {
  it('同じ space のページなら版を返す', async () => {
    await expect(wikiVersions({ spaceId: SPACE, pageId: PAGE, limit: 20 })).resolves.toEqual([])
  })

  it('別の space のページ（または存在しない）なら ToolUserError(404) を投げ、版は引かない', async () => {
    pageExistsInSpace = false

    const err = await wikiVersions({ spaceId: SPACE, pageId: PAGE, limit: 20 }).catch((e: unknown) => e)

    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
    expect(versionsCalls).toHaveLength(0)
  })
})
