import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * wiki_create でフォルダ（is_folder=true）を作れること、作るときに親ページを指定できることを確かめる。
 * 画面の「新しいフォルダ」と同じ行（本文は空文字・is_folder=true）が DB に入ることが目的。
 */
const inserts: Record<string, unknown>[] = []
let insertError: { message: string } | null = null

vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({
    from: (table: string) =>
      table === 'spaces'
        ? { select: () => ({ eq: () => ({ single: async () => ({ data: { org_id: 'org-1' }, error: null }) }) }) }
        : {
            insert: (payload: Record<string, unknown>) => {
              inserts.push(payload)
              return {
                select: () => ({
                  single: async () =>
                    insertError ? { data: null, error: insertError } : { data: { id: 'p-new', ...payload }, error: null },
                }),
              }
            },
          },
  }),
}))
vi.mock('../auth/helpers.js', () => ({ checkAuth: async () => ({ ctx: {} }) }))
vi.mock('../config.js', () => ({
  getAuthContext: () => ({ keyId: 'k', userId: 'actor-1', orgId: 'org-1', scope: 'org', allowedSpaceIds: null, allowedActions: ['read', 'write'] }),
}))

const { wikiCreate, wikiCreateSchema } = await import('./wiki.js')

const SPACE = '00000000-0000-0000-0000-000000000010'
const PARENT = '00000000-0000-0000-0000-0000000000aa'

beforeEach(() => {
  inserts.length = 0
  insertError = null
})

describe('wiki_create（フォルダ）', () => {
  it('folder: true で is_folder=true・本文は空文字（画面の「新しいフォルダ」と同じ）', async () => {
    await wikiCreate(wikiCreateSchema.parse({ spaceId: SPACE, title: '仕様書', folder: true }))
    expect(inserts).toHaveLength(1)
    expect(inserts[0]).toMatchObject({ is_folder: true, body: '' })
  })

  it('folder を渡さなければ is_folder=false のふつうのページ', async () => {
    await wikiCreate(wikiCreateSchema.parse({ spaceId: SPACE, title: 'メモ', body: '# 見出し' }))
    expect(inserts[0]).toMatchObject({ is_folder: false })
    expect(inserts[0].body).not.toBe('')
  })

  it('フォルダでも本文を渡せば保存する（フォルダにも本文を書ける Notion 型）', async () => {
    await wikiCreate(wikiCreateSchema.parse({ spaceId: SPACE, title: '仕様書', folder: true, body: '説明' }))
    expect(inserts[0].is_folder).toBe(true)
    expect(inserts[0].body).not.toBe('')
  })

  it('parentPageId を渡すと親の下に作る', async () => {
    await wikiCreate(wikiCreateSchema.parse({ spaceId: SPACE, title: '子', parentPageId: PARENT }))
    expect(inserts[0]).toMatchObject({ parent_page_id: PARENT })
  })

  it('parentPageId を渡さなければ根に作る（null）', async () => {
    await wikiCreate(wikiCreateSchema.parse({ spaceId: SPACE, title: '根' }))
    expect(inserts[0]).toMatchObject({ parent_page_id: null })
  })

  it('parentPageId は UUID でなければ弾く', () => {
    expect(() => wikiCreateSchema.parse({ spaceId: SPACE, title: 'x', parentPageId: 'abc' })).toThrow()
  })

  it('別スペースの親を指定すると、DB の拒否理由を日本語の 400 にする', async () => {
    insertError = { message: 'wiki parent must be in the same space' }
    await expect(
      wikiCreate(wikiCreateSchema.parse({ spaceId: SPACE, title: '子', parentPageId: PARENT }))
    ).rejects.toMatchObject({ message: expect.stringMatching(/同じスペース/), status: 400 })
  })

  it('見覚えのない DB エラーは中身を隠して「作成に失敗」にする', async () => {
    insertError = { message: 'permission denied for table wiki_pages' }
    await expect(wikiCreate(wikiCreateSchema.parse({ spaceId: SPACE, title: 'x' }))).rejects.toThrow(
      'Wikiページの作成に失敗しました'
    )
  })
})
