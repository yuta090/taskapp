import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * wiki_* が DB に断られた理由を、cause に残さず「〜に失敗しました」に握り潰していた
 * 箇所（wiki_get/wiki_toc の取得は既に直っている）の回帰テスト。0件（PGRST116）の
 * 単純な取得は ToolUserError(404) に、それ以外は一般Errorのまま、どちらも
 * 元のDBエラーを cause として残す。
 */

const SPACE = '00000000-0000-0000-0000-000000000010'
const PAGE = '00000000-0000-0000-0000-000000000001'

function chain(result: { data: unknown; error: unknown }) {
  const obj: Record<string, unknown> = {}
  const self = () => obj
  for (const m of ['select', 'eq', 'order', 'limit']) obj[m] = self
  obj.single = async () => result
  obj.maybeSingle = async () => result
  obj.then = (resolve: (v: unknown) => void) => resolve(result)
  return obj
}

/** table の select/update/insert/delete を、それぞれ独立した結果で返す簡易モック */
function tableMock(methods: Partial<Record<'select' | 'update' | 'insert' | 'delete', { data: unknown; error: unknown }>>) {
  const obj: Record<string, unknown> = {}
  for (const key of ['select', 'update', 'insert', 'delete'] as const) {
    const result = methods[key] ?? { data: null, error: null }
    obj[key] = () => chain(result)
  }
  return obj
}

let spaceResult: { data: unknown; error: unknown } = { data: { org_id: 'org-1' }, error: null }
let wikiPagesSelectResult: { data: unknown; error: unknown } = { data: { id: PAGE, body: '[]', title: 't' }, error: null }
let wikiPagesUpdateResult: { data: unknown; error: unknown } = { data: [{ id: PAGE, title: 't' }], error: null }
let wikiPagesInsertResult: { data: unknown; error: unknown } = { data: { id: PAGE }, error: null }
let wikiPagesDeleteResult: { data: unknown; error: unknown } = { data: null, error: null }
let wikiVersionsSelectResult: { data: unknown; error: unknown } = { data: [], error: null }

vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      if (table === 'spaces') return chain(spaceResult)
      if (table === 'wiki_pages')
        return tableMock({
          select: wikiPagesSelectResult,
          update: wikiPagesUpdateResult,
          insert: wikiPagesInsertResult,
          delete: wikiPagesDeleteResult,
        })
      if (table === 'wiki_page_versions') return tableMock({ select: wikiVersionsSelectResult, insert: { data: null, error: null } })
      return chain({ data: null, error: null })
    },
  }),
}))
vi.mock('../auth/helpers.js', () => ({ checkAuth: async () => ({ ctx: {} }) }))
vi.mock('../config.js', () => ({
  getAuthContext: () => ({ keyId: 'k', userId: 'actor-1', orgId: 'org-1', scope: 'org', allowedSpaceIds: null, allowedActions: ['read', 'write'] }),
}))
vi.mock('../lib/appLinks.js', () => ({ buildWikiPageLink: () => 'https://example.test/link', withLink: (row: unknown) => row }))

const { wikiList, wikiCreate, wikiUpdate, wikiDelete, wikiVersions, wikiToc } = await import('./wiki.js')

beforeEach(() => {
  spaceResult = { data: { org_id: 'org-1' }, error: null }
  wikiPagesSelectResult = { data: { id: PAGE, body: '[]', title: 't' }, error: null }
  wikiPagesUpdateResult = { data: [{ id: PAGE, title: 't' }], error: null }
  wikiPagesInsertResult = { data: { id: PAGE }, error: null }
  wikiPagesDeleteResult = { data: null, error: null }
  wikiVersionsSelectResult = { data: [], error: null }
})

describe('wiki_list — スペース取得(getOrgId)の断り方', () => {
  it('0件（PGRST116）は ToolUserError(404)、cause を残す', async () => {
    spaceResult = { data: null, error: { code: 'PGRST116', message: 'no rows' } }

    const err = (await wikiList({ spaceId: SPACE, limit: 50 }).catch((e: unknown) => e)) as Error & {
      status?: number
      cause?: unknown
    }

    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
    expect(err.message).toBe('スペースが見つかりません')
    expect(err.cause).toEqual(spaceResult.error)
  })

  it('それ以外は一般のErrorのまま、cause を残す', async () => {
    spaceResult = { data: null, error: { code: '42501', message: 'permission denied for table spaces' } }

    const err = (await wikiList({ spaceId: SPACE, limit: 50 }).catch((e: unknown) => e)) as Error & { cause?: unknown }

    expect(err).not.toMatchObject({ name: 'ToolUserError' })
    expect(err.message).not.toContain('permission denied')
    expect(err.cause).toEqual(spaceResult.error)
  })
})

describe('wiki_list — 一覧取得の断り方', () => {
  it('cause に元のDBエラーを残す', async () => {
    wikiPagesSelectResult = { data: null, error: { code: '42501', message: 'permission denied for table wiki_pages' } }

    const err = (await wikiList({ spaceId: SPACE, limit: 50 }).catch((e: unknown) => e)) as Error & { cause?: unknown }

    expect(err.message).not.toContain('permission denied')
    expect(err.cause).toEqual(wikiPagesSelectResult.error)
  })
})

describe('wiki_create — 作成の断り方', () => {
  it('cause に元のDBエラーを残す', async () => {
    wikiPagesInsertResult = { data: null, error: { code: '42501', message: 'permission denied for table wiki_pages' } }

    const err = (await wikiCreate({ spaceId: SPACE, title: 't' }).catch((e: unknown) => e)) as Error & { cause?: unknown }

    expect(err.message).not.toContain('permission denied')
    expect(err.cause).toEqual(wikiPagesInsertResult.error)
  })
})

describe('wiki_update — 更新の断り方', () => {
  it('見覚えのない理由は一般のErrorのまま、cause に元のDBエラーを残す', async () => {
    wikiPagesUpdateResult = { data: null, error: { message: 'some unexpected internal detail' } }

    const err = (await wikiUpdate({ spaceId: SPACE, pageId: PAGE, title: 't' }).catch((e: unknown) => e)) as Error & {
      cause?: unknown
    }

    expect(err).not.toMatchObject({ name: 'ToolUserError' })
    expect(err.cause).toEqual(wikiPagesUpdateResult.error)
  })

  it('見覚えのある理由（親子循環）はToolUserError(400)のまま、cause に元のDBエラーを残す', async () => {
    wikiPagesUpdateResult = { data: null, error: { message: 'wiki parent cycle detected' } }

    const err = (await wikiUpdate({ spaceId: SPACE, pageId: PAGE, title: 't' }).catch((e: unknown) => e)) as Error & {
      status?: number
      cause?: unknown
    }

    expect(err).toMatchObject({ name: 'ToolUserError', status: 400 })
    expect(err.cause).toEqual(wikiPagesUpdateResult.error)
  })
})

describe('wiki_delete — 削除の断り方', () => {
  it('cause に元のDBエラーを残す', async () => {
    wikiPagesDeleteResult = { data: null, error: { code: '42501', message: 'permission denied for table wiki_pages' } }

    const err = (await wikiDelete({ spaceId: SPACE, pageId: PAGE }).catch((e: unknown) => e)) as Error & { cause?: unknown }

    expect(err.message).not.toContain('permission denied')
    expect(err.cause).toEqual(wikiPagesDeleteResult.error)
  })
})

describe('wiki_versions — バージョン履歴取得の断り方', () => {
  it('cause に元のDBエラーを残す', async () => {
    wikiVersionsSelectResult = { data: null, error: { code: '42501', message: 'permission denied for table wiki_page_versions' } }

    const err = (await wikiVersions({ spaceId: SPACE, pageId: PAGE, limit: 20 }).catch((e: unknown) => e)) as Error & {
      cause?: unknown
    }

    expect(err.message).not.toContain('permission denied')
    expect(err.cause).toEqual(wikiVersionsSelectResult.error)
  })
})

describe('wiki_toc — 目次の更新の断り方', () => {
  it('cause に元のDBエラーを残す', async () => {
    wikiPagesUpdateResult = { data: null, error: { code: '42501', message: 'permission denied for table wiki_pages' } }

    const err = (await wikiToc({ spaceId: SPACE, pageId: PAGE, action: 'add' }).catch((e: unknown) => e)) as Error & {
      cause?: unknown
    }

    expect(err.message).not.toContain('permission denied')
    expect(err.cause).toEqual(wikiPagesUpdateResult.error)
  })
})
