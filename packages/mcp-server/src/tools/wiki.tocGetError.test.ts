import { describe, it, expect, vi } from 'vitest'

/**
 * wiki_toc も wiki_get と同じ .single() 直後の「見つかりません」握り潰しを持っていた
 * （ページ取得の理由をすべて同じ文言にしていた）。0件だけ ToolUserError(404)・
 * それ以外は一般Errorのまま、どちらも cause に元のDBエラーを残す。
 */

const SPACE = '00000000-0000-0000-0000-000000000010'
const PAGE = '00000000-0000-0000-0000-000000000001'
const ORG = 'org-1'

let wikiPagesError: { code?: string; message?: string } | null = null

vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({
    from: (table: string) =>
      table === 'spaces'
        ? { select: () => ({ eq: () => ({ single: async () => ({ data: { org_id: ORG }, error: null }) }) }) }
        : {
            select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ single: async () => ({ data: null, error: wikiPagesError }) }) }) }) }),
          },
  }),
}))
vi.mock('../auth/helpers.js', () => ({ checkAuth: async () => ({ ctx: {} }) }))
vi.mock('../config.js', () => ({
  getAuthContext: () => ({ keyId: 'k', userId: 'actor-1', orgId: ORG, scope: 'org', allowedSpaceIds: null, allowedActions: ['read', 'write'] }),
}))

const { wikiToc } = await import('./wiki.js')

describe('wiki_toc — ページ取得の断り方', () => {
  it('0件（PGRST116）は ToolUserError(404)', async () => {
    wikiPagesError = { code: 'PGRST116', message: 'no rows' }

    const err = (await wikiToc({ spaceId: SPACE, pageId: PAGE, action: 'add' }).catch((e: unknown) => e)) as Error & {
      status?: number
      cause?: unknown
    }

    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
    expect(err.cause).toEqual(wikiPagesError)
  })

  it('それ以外は一般のErrorのまま、cause に原因を残す', async () => {
    wikiPagesError = { code: '42501', message: 'permission denied' }

    const err = (await wikiToc({ spaceId: SPACE, pageId: PAGE, action: 'add' }).catch((e: unknown) => e)) as Error & { cause?: unknown }

    expect(err).not.toMatchObject({ name: 'ToolUserError' })
    expect(err.message).not.toContain('permission denied')
    expect(err.cause).toEqual(wikiPagesError)
  })
})
