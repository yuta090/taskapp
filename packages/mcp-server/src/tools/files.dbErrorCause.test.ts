import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * file_* が DB/Storage に断られた理由を、cause に残さず「〜に失敗しました」に
 * 握り潰していた箇所の回帰テスト。0件（PGRST116）の単純な取得は ToolUserError(404) に、
 * それ以外は一般Errorのまま、どちらも元のエラーを cause として残す。
 */

const SPACE = '11111111-1111-4111-8111-111111111111'
const FILE_ID = '22222222-2222-4222-8222-222222222222'

function chain(result: { data: unknown; error: unknown }) {
  const obj: Record<string, unknown> = {}
  const self = () => obj
  for (const m of ['select', 'eq', 'order', 'limit', 'or', 'update', 'insert']) obj[m] = self
  obj.single = async () => result
  obj.maybeSingle = async () => result
  obj.then = (resolve: (v: unknown) => void) => resolve(result)
  return obj
}

let spaceResult: { data: unknown; error: unknown } = { data: { org_id: 'org-1' }, error: null }
let fileListResult: { data: unknown; error: unknown } = { data: [], error: null }
let fileInsertResult: { data: unknown; error: unknown } = { data: { id: FILE_ID }, error: null }
let fileLookupResult: { data: unknown; error: unknown } = {
  data: { id: FILE_ID, org_id: 'org-1', space_id: SPACE, uploaded_by: 'u-taka', name: 'a.csv', storage_path: `${SPACE}/${FILE_ID}/a.csv`, status: 'pending' },
  error: null,
}
let fileUpdateResult: { data: unknown; error: unknown } = { data: { id: FILE_ID }, error: null }
let fileUpdateCompleteResult: { error: unknown } = { error: null }
let signedResult: { data: unknown; error: unknown } = { data: { signedUrl: 'https://x/sign', token: 't' }, error: null }
let storageListResult: { data: unknown; error: unknown } = { data: [{ name: 'a.csv' }], error: null }

vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      if (table === 'spaces') return chain(spaceResult)
      if (table === 'files') {
        // fileList は select().eq().eq().order().limit() をそのまま await する（.then）。
        // fileUploadUrl の insert は insert().select().single()。
        // fileUploadComplete の select-lookup は select().eq().eq().single()。
        // fileUploadComplete の update は update().eq() を await する（.then）。
        // fileUpdate の update は update().eq().eq().eq().select().single()。
        // 呼び分けは各テストで使う値を1つだけ意味のある形にして注入する。
        return {
          select: () => chain(fileListResult.error || (fileListResult.data as unknown[])?.length ? fileListResult : fileLookupResult),
          insert: () => ({ select: () => ({ single: async () => fileInsertResult }) }),
          update: (patch: Record<string, unknown>) =>
            patch.status === 'ready'
              ? { eq: () => Promise.resolve(fileUpdateCompleteResult) }
              : { eq: () => ({ eq: () => ({ eq: () => ({ select: () => ({ single: async () => fileUpdateResult }) }) }) }) },
          delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
        }
      }
      return chain({ data: null, error: null })
    },
    storage: {
      from: () => ({
        createSignedUploadUrl: async () => signedResult,
        list: async () => storageListResult,
      }),
    },
  }),
}))
vi.mock('../auth/helpers.js', () => ({
  checkAuth: async () => ({ ctx: { userId: 'u-taka' }, role: 'admin' }),
}))

const { fileList, fileUploadUrl, fileUploadComplete, fileUpdate } = await import('./files.js')

beforeEach(() => {
  spaceResult = { data: { org_id: 'org-1' }, error: null }
  fileListResult = { data: [], error: null }
  fileInsertResult = { data: { id: FILE_ID }, error: null }
  fileLookupResult = {
    data: { id: FILE_ID, org_id: 'org-1', space_id: SPACE, uploaded_by: 'u-taka', name: 'a.csv', storage_path: `${SPACE}/${FILE_ID}/a.csv`, status: 'pending' },
    error: null,
  }
  fileUpdateResult = { data: { id: FILE_ID }, error: null }
  fileUpdateCompleteResult = { error: null }
  signedResult = { data: { signedUrl: 'https://x/sign', token: 't' }, error: null }
  storageListResult = { data: [{ name: 'a.csv' }], error: null }
})

describe('file_upload_url — スペース取得(getOrgId)の断り方', () => {
  it('0件（PGRST116）は ToolUserError(404)、cause を残す', async () => {
    spaceResult = { data: null, error: { code: 'PGRST116', message: 'no rows' } }

    const err = (await fileUploadUrl({ spaceId: SPACE, name: 'a.csv', sizeBytes: 10 }).catch((e: unknown) => e)) as Error & {
      status?: number
      cause?: unknown
    }

    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
    expect(err.message).toBe('スペースが見つかりません')
    expect(err.cause).toEqual(spaceResult.error)
  })

  it('それ以外は一般のErrorのまま、cause を残す', async () => {
    spaceResult = { data: null, error: { code: '42501', message: 'permission denied for table spaces' } }

    const err = (await fileUploadUrl({ spaceId: SPACE, name: 'a.csv', sizeBytes: 10 }).catch((e: unknown) => e)) as Error & {
      cause?: unknown
    }

    expect(err).not.toMatchObject({ name: 'ToolUserError' })
    expect(err.message).not.toContain('permission denied')
    expect(err.cause).toEqual(spaceResult.error)
  })
})

describe('file_list — 一覧取得の断り方', () => {
  it('cause に元のDBエラーを残す', async () => {
    fileListResult = { data: null, error: { code: '42501', message: 'permission denied for table files' } }

    const err = (await fileList({ spaceId: SPACE, limit: 50 }).catch((e: unknown) => e)) as Error & { cause?: unknown }

    expect(err.message).not.toContain('permission denied')
    expect(err.cause).toEqual(fileListResult.error)
  })
})

describe('file_upload_url — 行の登録(insert)の断り方', () => {
  it('cause に元のDBエラーを残す', async () => {
    fileInsertResult = { data: null, error: { code: '42501', message: 'permission denied for table files' } }

    const err = (await fileUploadUrl({ spaceId: SPACE, name: 'a.csv', sizeBytes: 10 }).catch((e: unknown) => e)) as Error & {
      cause?: unknown
    }

    expect(err.message).not.toContain('permission denied')
    expect(err.cause).toEqual(fileInsertResult.error)
  })
})

describe('file_upload_url — 署名URL発行の断り方', () => {
  it('cause に元のエラーを残す', async () => {
    signedResult = { data: null, error: { message: 'signature failed' } }

    const err = (await fileUploadUrl({ spaceId: SPACE, name: 'a.csv', sizeBytes: 10 }).catch((e: unknown) => e)) as Error & {
      cause?: unknown
    }

    expect(err.message).toBe('アップロード用URLの発行に失敗しました')
    expect(err.cause).toEqual(signedResult.error)
  })
})

describe('file_upload_complete — ファイル取得の断り方', () => {
  it('0件（PGRST116）は ToolUserError(404)「ファイルが見つかりません」、cause を残す', async () => {
    fileLookupResult = { data: null, error: { code: 'PGRST116', message: 'no rows' } }

    const err = (await fileUploadComplete({ spaceId: SPACE, fileId: FILE_ID }).catch((e: unknown) => e)) as Error & {
      status?: number
      cause?: unknown
    }

    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
    expect(err.message).toBe('ファイルが見つかりません')
    expect(err.cause).toEqual(fileLookupResult.error)
  })

  it('それ以外は一般のErrorのまま、cause を残す', async () => {
    fileLookupResult = { data: null, error: { code: '42501', message: 'permission denied for table files' } }

    const err = (await fileUploadComplete({ spaceId: SPACE, fileId: FILE_ID }).catch((e: unknown) => e)) as Error & {
      cause?: unknown
    }

    expect(err).not.toMatchObject({ name: 'ToolUserError' })
    expect(err.message).not.toContain('permission denied')
    expect(err.cause).toEqual(fileLookupResult.error)
  })
})

describe('file_upload_complete — Storage確認・完了処理の断り方', () => {
  it('Storage一覧の取得に失敗しても、cause に元のエラーを残す', async () => {
    storageListResult = { data: null, error: { message: 'list failed' } }

    const err = (await fileUploadComplete({ spaceId: SPACE, fileId: FILE_ID }).catch((e: unknown) => e)) as Error & {
      cause?: unknown
    }

    expect(err.message).toBe('アップロードの確認に失敗しました')
    expect(err.cause).toEqual(storageListResult.error)
  })

  it('status=ready への更新に失敗しても、cause に元のDBエラーを残す', async () => {
    fileUpdateCompleteResult = { error: { code: '42501', message: 'permission denied for table files' } }

    const err = (await fileUploadComplete({ spaceId: SPACE, fileId: FILE_ID }).catch((e: unknown) => e)) as Error & {
      cause?: unknown
    }

    expect(err.message).not.toContain('permission denied')
    expect(err.cause).toEqual(fileUpdateCompleteResult.error)
  })
})

describe('file_update — 更新の断り方', () => {
  it('0件（PGRST116）は元のToolUserError(404)のまま、cause を残す', async () => {
    fileUpdateResult = { data: null, error: { code: 'PGRST116', message: 'no rows' } }

    const err = (await fileUpdate({ spaceId: SPACE, fileId: FILE_ID, name: 'b.csv' }).catch((e: unknown) => e)) as Error & {
      status?: number
      cause?: unknown
    }

    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
    expect(err.message).toBe('ファイルが見つかりません（アップロード中は更新できません）')
    expect(err.cause).toEqual(fileUpdateResult.error)
  })

  it('それ以外は一般のErrorのまま、cause を残す', async () => {
    fileUpdateResult = { data: null, error: { code: '42501', message: 'permission denied for table files' } }

    const err = (await fileUpdate({ spaceId: SPACE, fileId: FILE_ID, name: 'b.csv' }).catch((e: unknown) => e)) as Error & {
      cause?: unknown
    }

    expect(err).not.toMatchObject({ name: 'ToolUserError' })
    expect(err.message).not.toContain('permission denied')
    expect(err.cause).toEqual(fileUpdateResult.error)
  })
})
