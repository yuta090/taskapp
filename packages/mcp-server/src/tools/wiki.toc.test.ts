import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * wiki_toc: 目次ブロック（tableOfContents）の追加/削除。
 * 追加は見出し1の直後（無ければ先頭）に入れ、既にあれば何もしない（冪等）。
 * 削除は目次ブロックが無ければ何もしない。どちらも本文を書き換えたときだけ
 * wiki_page_versions に控えを残す（wiki_update と同じ）。
 */

const SPACE = '00000000-0000-0000-0000-000000000010'
const PAGE = '00000000-0000-0000-0000-000000000001'
const ORG = 'org-1'

const H1 = { type: 'heading', props: { level: 1 }, content: [{ type: 'text', text: '題名', styles: {} }] }
const H2 = { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: '小見出し', styles: {} }] }
const PARA = { type: 'paragraph', content: [{ type: 'text', text: '本文', styles: {} }] }
const TOC = { type: 'tableOfContents', props: {} }

let pageBody = ''
const updates: Array<{ body: string; updated_by: string }> = []
const versionInserts: Array<Record<string, unknown>> = []

function wikiPagesChain() {
  const c: Record<string, unknown> = {}
  c.select = () => c
  c.eq = () => c
  c.single = async () => ({ data: { id: PAGE, org_id: ORG, space_id: SPACE, title: 'ページ', body: pageBody, updated_at: 't0' }, error: null })
  c.update = (payload: { body: string; updated_by: string }) => {
    updates.push(payload)
    // 実装は .eq() を3〜4回挟んでから .select() を待つ。回数によらず動くよう自己参照にする
    const u: Record<string, unknown> = {}
    u.eq = () => u
    u.select = async () => ({ data: [{ id: PAGE, title: 'ページ', body: payload.body, updated_at: 't1' }], error: null })
    return u
  }
  return c
}

vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({
    from: (table: string) =>
      table === 'spaces'
        ? { select: () => ({ eq: () => ({ single: async () => ({ data: { org_id: ORG }, error: null }) }) }) }
        : table === 'wiki_pages'
          ? wikiPagesChain()
          : {
              insert: (payload: Record<string, unknown>) => {
                versionInserts.push(payload)
                return { error: null }
              },
            },
  }),
}))
vi.mock('../auth/helpers.js', () => ({ checkAuth: async () => ({ ctx: {} }) }))
vi.mock('../config.js', () => ({ getAuthContext: () => ({ keyId: 'k', userId: 'actor-1', orgId: ORG, scope: 'org', allowedSpaceIds: null, allowedActions: ['read', 'write'] }) }))

const { wikiToc } = await import('./wiki.js')

beforeEach(() => {
  pageBody = ''
  updates.length = 0
  versionInserts.length = 0
})

describe('wiki_toc — add', () => {
  it('見出し1の直後に目次ブロックを入れる', async () => {
    pageBody = JSON.stringify([H1, PARA])

    await wikiToc({ spaceId: SPACE, pageId: PAGE, action: 'add' })

    expect(updates).toHaveLength(1)
    const blocks = JSON.parse(updates[0].body)
    expect(blocks).toEqual([H1, TOC, PARA])
  })

  it('見出し1が無ければ先頭に入れる', async () => {
    pageBody = JSON.stringify([H2, PARA])

    await wikiToc({ spaceId: SPACE, pageId: PAGE, action: 'add' })

    const blocks = JSON.parse(updates[0].body)
    expect(blocks).toEqual([TOC, H2, PARA])
  })

  it('本文が空でも先頭に入れる', async () => {
    pageBody = ''

    await wikiToc({ spaceId: SPACE, pageId: PAGE, action: 'add' })

    const blocks = JSON.parse(updates[0].body)
    expect(blocks).toEqual([TOC])
  })

  it('既に目次があれば何もしない（冪等）', async () => {
    pageBody = JSON.stringify([H1, TOC, PARA])

    const result = await wikiToc({ spaceId: SPACE, pageId: PAGE, action: 'add' })

    expect(updates).toHaveLength(0)
    expect(versionInserts).toHaveLength(0)
    expect(result.body).toBe(pageBody)
  })

  it('action を省略すると add になる', async () => {
    pageBody = JSON.stringify([H1])

    await wikiToc({ spaceId: SPACE, pageId: PAGE } as never)

    expect(JSON.parse(updates[0].body)).toEqual([H1, TOC])
  })

  it('本文を書き換えたときだけバージョンの控えを残す', async () => {
    pageBody = JSON.stringify([H1])

    await wikiToc({ spaceId: SPACE, pageId: PAGE, action: 'add' })

    expect(versionInserts).toHaveLength(1)
    expect(versionInserts[0]).toMatchObject({ page_id: PAGE, org_id: ORG })
  })
})

describe('wiki_toc — remove', () => {
  it('目次ブロックを外す', async () => {
    pageBody = JSON.stringify([H1, TOC, PARA])

    await wikiToc({ spaceId: SPACE, pageId: PAGE, action: 'remove' })

    const blocks = JSON.parse(updates[0].body)
    expect(blocks).toEqual([H1, PARA])
  })

  it('目次が無ければ何もしない', async () => {
    pageBody = JSON.stringify([H1, PARA])

    const result = await wikiToc({ spaceId: SPACE, pageId: PAGE, action: 'remove' })

    expect(updates).toHaveLength(0)
    expect(result.body).toBe(pageBody)
  })
})
