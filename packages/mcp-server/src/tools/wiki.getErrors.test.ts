import { describe, it, expect, vi } from 'vitest'

/**
 * wiki_get / wiki_toc の「ページ取得」は、DBが .single() で断った理由を全部
 * 「見つかりません」に潰していた。0件（PGRST116）は本当に見つからないので
 * ToolUserError(404) でよいが、それ以外（権限エラー等）まで同じ文言の
 * 一般Errorにすると、/api/tools が中身を隠した500に潰し、呼んだ人には
 * 何も分からず、運営もサーバーログでしか原因を追えなかった。
 *
 * 直した後は、0件だけ ToolUserError(404)・それ以外は一般Errorのままだが、
 * どちらも元のDBエラーを cause として持つ（運営画面の利用記録から追えるように）。
 */

const SPACE = '00000000-0000-0000-0000-000000000010'
const PAGE = '00000000-0000-0000-0000-000000000001'
const ORG = 'org-1'

let wikiPagesError: { code?: string; message?: string } | null = null
let wikiPagesData: Record<string, unknown> | null = null

vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({
    from: (table: string) =>
      table === 'spaces'
        ? { select: () => ({ eq: () => ({ single: async () => ({ data: { org_id: ORG }, error: null }) }) }) }
        : {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    single: async () => ({ data: wikiPagesData, error: wikiPagesError }),
                  }),
                }),
              }),
            }),
          },
  }),
}))
vi.mock('../auth/helpers.js', () => ({ checkAuth: async () => ({ ctx: {} }) }))
vi.mock('../config.js', () => ({
  getAuthContext: () => ({ keyId: 'k', userId: 'actor-1', orgId: ORG, scope: 'org', allowedSpaceIds: null, allowedActions: ['read', 'write'] }),
}))
vi.mock('../lib/appLinks.js', () => ({
  buildWikiPageLink: () => 'https://example.test/link',
  withLink: (row: unknown) => row,
}))

const { wikiGet } = await import('./wiki.js')

describe('wiki_get — DBが断った理由を握り潰さない', () => {
  it('0件（PGRST116）は ToolUserError(404) で「見つかりません」', async () => {
    wikiPagesError = { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }
    wikiPagesData = null

    const err = (await wikiGet({ spaceId: SPACE, pageId: PAGE }).catch((e: unknown) => e)) as Error & {
      status?: number
      cause?: unknown
    }

    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
    expect(err.message).toBe('Wikiページが見つかりません')
    expect(err.cause).toEqual(wikiPagesError)
  })

  it('権限エラー等は一般のErrorのまま（生のDB文言は出さない）が、cause に原因を残す', async () => {
    wikiPagesError = { code: '42501', message: 'permission denied for table wiki_pages' }
    wikiPagesData = null

    const err = (await wikiGet({ spaceId: SPACE, pageId: PAGE }).catch((e: unknown) => e)) as Error & { cause?: unknown }

    expect(err).not.toMatchObject({ name: 'ToolUserError' })
    expect(err.message).not.toContain('permission denied')
    expect(err.cause).toEqual(wikiPagesError)
  })
})
