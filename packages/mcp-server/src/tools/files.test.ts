import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * file_* ツール（`agentpm file list / upload` の実体）の DB/Storage 境界テスト。
 *   - file_upload_url: pending 行を作り、署名アップロードURLを返す。名前・サイズを検証する
 *   - file_upload_complete: Storage に実体があるときだけ ready にする。二重実行は何もしない
 *   - file_list: ready のものだけ新しい順
 *   - 認可は checkAuth 経由（write / read）
 */

type Row = Record<string, unknown>
const db: Record<string, Row[]> = {}
const inserted: { table: string; row: Row }[] = []
const updated: { table: string; patch: Row; id: unknown }[] = []
const deleted: { table: string; id: unknown }[] = []
const orCalls: string[] = []
let storageListing: { name: string }[] = []
let signedUploadResult: { data: { signedUrl: string; token: string; path: string } | null; error: { message: string } | null }

const CTX = { keyId: 'k', userId: 'u-taka', orgId: 'org-1', scope: 'org', allowedSpaceIds: null, allowedActions: ['read', 'write'] }
// checkAuth(spaceId, action, toolName, resourceType, resourceId?) → { ctx, role }
const authorizeMock = vi.fn(async (..._args: unknown[]) => ({ ctx: CTX, role: 'admin' }))

function query(table: string) {
  let rows = db[table] ?? []
  const q: Record<string, unknown> = {}
  const chain = () => q
  q.select = chain
  q.order = chain
  q.limit = chain
  q.eq = (col: string, v: unknown) => { rows = rows.filter((r) => r[col] === v); return q }
  // "client_visible.eq.true,uploaded_by.eq.<uid>" だけ解釈する簡易版
  q.or = (expr: string) => {
    const conds = expr.split(',').map((c) => c.split('.eq.'))
    rows = rows.filter((r) => conds.some(([col, v]) => String(r[col]) === v))
    orCalls.push(expr)
    return q
  }
  q.single = async () => ({ data: rows[0] ?? null, error: rows[0] ? null : { message: 'not found' } })
  q.then = (resolve: (v: unknown) => void) => resolve({ data: rows, error: null })
  q.insert = (payload: Row) => {
    inserted.push({ table, row: payload })
    const sel = { single: async () => ({ data: payload, error: null }) }
    return { select: () => sel }
  }
  q.update = (patch: Row) => ({
    eq: (_col: string, id: unknown) => { updated.push({ table, patch, id }); return Promise.resolve({ error: null }) },
  })
  q.delete = () => ({ eq: (_c: string, id: unknown) => { deleted.push({ table, id }); return Promise.resolve({ error: null }) } })
  return q
}

const storage = {
  from: () => ({
    createSignedUploadUrl: vi.fn(async () => signedUploadResult),
    list: vi.fn(async () => ({ data: storageListing, error: null })),
  }),
}

vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({ from: query, storage }),
}))
vi.mock('../config.js', () => ({
  config: { actorId: 'u-taka' },
  getAuthContext: () => ({ keyId: 'k', userId: 'u-taka', orgId: 'org-1', scope: 'org', allowedSpaceIds: null, allowedActions: ['read', 'write'] }),
}))
vi.mock('../auth/helpers.js', () => ({
  checkAuth: (...args: unknown[]) => authorizeMock(...args),
}))

const { fileUploadUrl, fileUploadComplete, fileList, toStorageKeyName } = await import('./files.js')

const SPACE = '11111111-1111-4111-8111-111111111111'
const FILE_ID = '22222222-2222-4222-8222-222222222222'

beforeEach(() => {
  inserted.length = 0
  updated.length = 0
  deleted.length = 0
  orCalls.length = 0
  authorizeMock.mockClear()
  authorizeMock.mockResolvedValue({ ctx: CTX, role: 'admin' })
  storageListing = []
  signedUploadResult = {
    data: { signedUrl: 'https://storage.example/object/upload/sign/x?token=tok', token: 'tok', path: 'p' },
    error: null,
  }
  db.spaces = [{ id: SPACE, org_id: 'org-1' }]
  db.files = []
})

describe('file_upload_url', () => {
  it('pending の files 行を作り、署名アップロードURLを返す', async () => {
    const r = await fileUploadUrl({ spaceId: SPACE, name: 'ターゲット一覧.csv', mimeType: 'text/csv', sizeBytes: 1234 })

    expect(authorizeMock).toHaveBeenCalledWith(SPACE, 'write', 'file_upload_url', 'file')
    expect(inserted).toHaveLength(1)
    expect(inserted[0].table).toBe('files')
    expect(inserted[0].row).toMatchObject({
      org_id: 'org-1',
      space_id: SPACE,
      uploaded_by: 'u-taka',
      origin: 'internal',
      client_visible: false,
      name: 'ターゲット一覧.csv',
      mime_type: 'text/csv',
      size_bytes: 1234,
      status: 'pending',
    })
    // 表示名は日本語のまま、鍵(storage_path)は ASCII に落ちる(日本語のままだと Storage が InvalidKey で拒む)
    expect(String(inserted[0].row.storage_path)).toBe(`${SPACE}/${r.fileId}/file.csv`)
    expect(r.signedUrl).toContain('token=tok')
    expect(r.token).toBe('tok')
  })

  it('client / vendor 権限のキーは origin=client・client_visible=true を強制する（Web と同じ）', async () => {
    authorizeMock.mockResolvedValue({ ctx: CTX, role: 'client' })
    await fileUploadUrl({ spaceId: SPACE, name: 'a.pdf', sizeBytes: 10 })
    expect(inserted[0].row).toMatchObject({ origin: 'client', client_visible: true })
  })

  it('名前にパス区切りや # ? が入っていれば拒否する', async () => {
    for (const name of ['../x.csv', 'a\\b.csv', 'a#1.csv', 'a?.csv']) {
      await expect(fileUploadUrl({ spaceId: SPACE, name, sizeBytes: 10 })).rejects.toThrow(/ファイル名/)
    }
    expect(inserted).toHaveLength(0)
  })

  it('鍵に利用者が紐づいていなければ、共有の actorId に頼らず拒否する', async () => {
    authorizeMock.mockResolvedValue({ ctx: { ...CTX, userId: null }, role: 'admin' })
    await expect(fileUploadUrl({ spaceId: SPACE, name: 'a.csv', sizeBytes: 10 })).rejects.toThrow(/利用者/)
    expect(inserted).toHaveLength(0)
  })

  it('50MB を超えるサイズは拒否する', async () => {
    await expect(fileUploadUrl({ spaceId: SPACE, name: 'big.zip', sizeBytes: 52428801 })).rejects.toThrow(/50MB/)
    expect(inserted).toHaveLength(0)
  })

  it('署名URLの発行に失敗したら作った行を消して失敗にする', async () => {
    signedUploadResult = { data: null, error: { message: 'boom' } }
    await expect(fileUploadUrl({ spaceId: SPACE, name: 'a.csv', sizeBytes: 10 })).rejects.toThrow()
    expect(deleted).toHaveLength(1)
    expect(deleted[0].table).toBe('files')
  })

  it('mimeType を省略したら application/octet-stream', async () => {
    await fileUploadUrl({ spaceId: SPACE, name: 'a.bin', sizeBytes: 10 })
    expect(inserted[0].row.mime_type).toBe('application/octet-stream')
  })
})

describe('file_upload_complete', () => {
  const pending = () => ({
    id: FILE_ID, org_id: 'org-1', space_id: SPACE, uploaded_by: 'u-taka', origin: 'internal',
    client_visible: false, name: 'a.csv', mime_type: 'text/csv', storage_path: `${SPACE}/${FILE_ID}/a.csv`, status: 'pending',
  })

  it('Storage に実体があれば ready にする', async () => {
    db.files = [pending()]
    storageListing = [{ name: 'a.csv' }]
    const r = await fileUploadComplete({ spaceId: SPACE, fileId: FILE_ID })
    expect(updated).toEqual([{ table: 'files', patch: { status: 'ready' }, id: FILE_ID }])
    expect(r).toMatchObject({ ok: true, fileId: FILE_ID, name: 'a.csv', downloadPath: `/api/files/${FILE_ID}/download` })
  })

  it('CSV/TSV なら表ビューのパスも返す', async () => {
    db.files = [pending()]
    storageListing = [{ name: 'a.csv' }]
    const r = await fileUploadComplete({ spaceId: SPACE, fileId: FILE_ID })
    expect(r.tablePath).toBe(`/org-1/project/${SPACE}/files/${FILE_ID}`)
  })

  it('Storage に実体が無ければ「アップロードが完了していません」', async () => {
    db.files = [pending()]
    storageListing = []
    await expect(fileUploadComplete({ spaceId: SPACE, fileId: FILE_ID })).rejects.toThrow(/完了していません/)
    expect(updated).toHaveLength(0)
  })

  it('既に ready なら何もしないで ok', async () => {
    db.files = [{ ...pending(), status: 'ready' }]
    const r = await fileUploadComplete({ spaceId: SPACE, fileId: FILE_ID })
    expect(r.ok).toBe(true)
    expect(updated).toHaveLength(0)
  })

  it('別の人がアップロード中の行は完了にできない', async () => {
    db.files = [{ ...pending(), uploaded_by: 'someone-else' }]
    await expect(fileUploadComplete({ spaceId: SPACE, fileId: FILE_ID })).rejects.toThrow(/権限/)
  })

  it('別スペースのファイルIDは見つからない扱い', async () => {
    db.files = [{ ...pending(), space_id: 'other-space' }]
    await expect(fileUploadComplete({ spaceId: SPACE, fileId: FILE_ID })).rejects.toThrow(/見つかりません/)
  })
})

describe('file_list', () => {
  it('ready のファイルだけを返す（read 認可）', async () => {
    db.files = [
      { id: 'f1', space_id: SPACE, name: 'a.csv', status: 'ready', mime_type: 'text/csv', size_bytes: 1, origin: 'internal', client_visible: false, created_at: '2026-09-07' },
      { id: 'f2', space_id: SPACE, name: 'b.pdf', status: 'pending', mime_type: 'application/pdf', size_bytes: 1, origin: 'internal', client_visible: false, created_at: '2026-09-07' },
    ]
    const r = await fileList({ spaceId: SPACE, limit: 50 })
    expect(authorizeMock).toHaveBeenCalledWith(SPACE, 'read', 'file_list', 'file')
    expect(r.map((f) => f.id)).toEqual(['f1'])
    expect(r[0].downloadPath).toBe('/api/files/f1/download')
    expect(orCalls).toHaveLength(0)
  })

  it('client / vendor 権限の鍵には、クライアント公開か自分がアップロードしたものだけ返す（RLS と同じ範囲）', async () => {
    authorizeMock.mockResolvedValue({ ctx: CTX, role: 'client' })
    db.files = [
      { id: 'f-internal', space_id: SPACE, name: '見積_原価.xlsx', status: 'ready', client_visible: false, uploaded_by: 'u-other', mime_type: 'x', size_bytes: 1, origin: 'internal', created_at: '2026-09-07' },
      { id: 'f-public', space_id: SPACE, name: '成果物.pdf', status: 'ready', client_visible: true, uploaded_by: 'u-other', mime_type: 'x', size_bytes: 1, origin: 'internal', created_at: '2026-09-07' },
      { id: 'f-mine', space_id: SPACE, name: '提出.csv', status: 'ready', client_visible: false, uploaded_by: 'u-taka', mime_type: 'x', size_bytes: 1, origin: 'client', created_at: '2026-09-07' },
    ]
    const r = await fileList({ spaceId: SPACE, limit: 50 })
    expect(r.map((f) => f.id).sort()).toEqual(['f-mine', 'f-public'])
    expect(orCalls[0]).toBe('client_visible.eq.true,uploaded_by.eq.u-taka')
  })
})

describe('toStorageKeyName', () => {
  it('日本語・全角記号・空白を "_" にまとめ、拡張子を残す(Web 側 storageKey.ts と同じ規則)', () => {
    expect(toStorageKeyName('list.csv')).toBe('list.csv')
    expect(toStorageKeyName('DXセミナー＞研修販売に向けたタスク - No.5_標準機能一覧_20260904.csv')).toBe('DX_-_No.5_20260904.csv')
    expect(toStorageKeyName('資料')).toBe('file')
    expect(toStorageKeyName('a#b?c.txt')).toBe('a_b_c.txt')
  })
})
