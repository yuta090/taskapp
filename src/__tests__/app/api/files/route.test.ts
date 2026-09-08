import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * GET /api/files — lists ready files for a space (RLS決定の可視性 + 明示的な
 * メンバーシップチェック)。uploaderName は profiles.display_name を解決する。
 */

const SPACE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const USER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const UPLOADER_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

const mockUser = { id: USER_ID }

let authResponse: { data: { user: typeof mockUser | null } }
let membershipResponse: { data: { id: string } | null; error: null }
let filesListResponse: { data: Array<Record<string, unknown>> | null; error: { message: string } | null }
let profilesResponse: { data: Array<Record<string, unknown>> | null; error: null }

let filesLimitArg: number | undefined
let filesOrArgs: string[] = []
let filesEqArgs: Array<[string, unknown]> = []

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chain(response: any, opts: { captureLimit?: boolean } = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {}
  for (const m of ['select', 'eq', 'neq', 'in', 'order', 'limit', 'insert', 'update', 'upsert', 'delete']) {
    builder[m] = vi.fn(() => builder)
  }
  if (opts.captureLimit) {
    builder.limit = vi.fn((n: number) => {
      filesLimitArg = n
      return builder
    })
    builder.or = vi.fn((expr: string) => {
      filesOrArgs.push(expr)
      return builder
    })
    builder.eq = vi.fn((col: string, val: unknown) => {
      filesEqArgs.push([col, val])
      return builder
    })
  }
  builder.single = vi.fn(() => Promise.resolve(response))
  builder.maybeSingle = vi.fn(() => Promise.resolve(response))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  builder.then = (resolve: any, reject?: any) => Promise.resolve(response).then(resolve, reject)
  return builder
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: { getSession: () => Promise.resolve({ data: { session: null } }), mfa: { listFactors: () => Promise.resolve({ data: { all: [] }, error: null }) },  getUser: vi.fn(() => Promise.resolve(authResponse)) },
      from: vi.fn((table: string) => {
        if (table === 'space_memberships') return chain(membershipResponse)
        if (table === 'files') return chain(filesListResponse, { captureLimit: true })
        if (table === 'profiles') return chain(profilesResponse)
        throw new Error(`Unexpected table: ${table}`)
      }),
    })
  ),
}))

const { GET } = await import('@/app/api/files/route')
const { FILES_LIST_LIMIT } = await import('@/lib/files/limits')

function callGet(spaceId?: string, params: Record<string, string> = {}) {
  const url = new URL('/api/files', 'http://localhost:3000')
  if (spaceId !== undefined) url.searchParams.set('spaceId', spaceId)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return GET(new NextRequest(url))
}

describe('GET /api/files', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    filesLimitArg = undefined
    filesOrArgs = []
    filesEqArgs = []
    authResponse = { data: { user: mockUser } }
    membershipResponse = { data: { id: 'membership-1' }, error: null }
    filesListResponse = {
      data: [
        {
          id: 'file-1',
          name: '要件定義書.pdf',
          mime_type: 'application/pdf',
          size_bytes: 2048,
          origin: 'internal',
          client_visible: false,
          uploaded_by: UPLOADER_ID,
          description: '第2四半期の要件まとめ',
          created_at: '2026-07-07T00:00:00.000Z',
        },
      ],
      error: null,
    }
    profilesResponse = { data: [{ id: UPLOADER_ID, display_name: '山田太郎' }], error: null }
  })

  it('returns 401 when not authenticated', async () => {
    authResponse = { data: { user: null } }
    const response = await callGet(SPACE_ID)
    expect(response.status).toBe(401)
  })

  it('returns 400 when spaceId is missing or malformed', async () => {
    const response = await callGet('not-a-uuid')
    expect(response.status).toBe(400)
  })

  it('returns 403 when the user has no membership in the space', async () => {
    membershipResponse = { data: null, error: null }
    const response = await callGet(SPACE_ID)
    expect(response.status).toBe(403)
  })

  it('returns 500 when the files fetch fails', async () => {
    filesListResponse = { data: null, error: { message: 'db error' } }
    const response = await callGet(SPACE_ID)
    expect(response.status).toBe(500)
  })

  it('returns files enriched with uploaderName', async () => {
    const response = await callGet(SPACE_ID)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.files).toHaveLength(1)
    expect(data.files[0]).toMatchObject({
      id: 'file-1',
      name: '要件定義書.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 2048,
      origin: 'internal',
      clientVisible: false,
      uploadedBy: UPLOADER_ID,
      uploaderName: '山田太郎',
      description: '第2四半期の要件まとめ',
      createdAt: '2026-07-07T00:00:00.000Z',
    })
  })

  it('件数に上限をかける(IDBに一覧が丸ごと載って他の画面まで遅くなるのを防ぐ)', async () => {
    await callGet(SPACE_ID)
    // 「まだ続きがあるか」を知るために上限+1件だけ取る
    expect(filesLimitArg).toBe(FILES_LIST_LIMIT + 1)
    expect(FILES_LIST_LIMIT).toBeLessThanOrEqual(500)
  })

  it('description は未設定なら null で返す', async () => {
    filesListResponse = {
      data: [
        {
          id: 'file-2',
          name: 'メモ.txt',
          mime_type: 'text/plain',
          size_bytes: 10,
          origin: 'internal',
          client_visible: false,
          uploaded_by: UPLOADER_ID,
          description: null,
          created_at: '2026-07-07T00:00:00.000Z',
        },
      ],
      error: null,
    }
    const response = await callGet(SPACE_ID)
    const data = await response.json()
    expect(data.files[0].description).toBeNull()
  })

  it('falls back to "メンバー" when the uploader has no display name', async () => {
    profilesResponse = { data: [{ id: UPLOADER_ID, display_name: '' }], error: null }
    const response = await callGet(SPACE_ID)
    const data = await response.json()
    expect(data.files[0].uploaderName).toBe('メンバー')
  })

  it('returns an empty list without querying profiles when there are no files', async () => {
    filesListResponse = { data: [], error: null }
    const response = await callGet(SPACE_ID)
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.files).toEqual([])
  })
})

/**
 * 500件を超えるスペースで古いファイルも探せるように、絞り込みをSQL側で受ける。
 * 種類(kind)は「取りこぼさない超集合」で絞り、正確な判定はクライアントが再度かける。
 */
describe('GET /api/files — サーバー側の絞り込み', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    filesLimitArg = undefined
    filesOrArgs = []
    filesEqArgs = []
    authResponse = { data: { user: mockUser } }
    membershipResponse = { data: { id: 'membership-1' }, error: null }
    filesListResponse = { data: [], error: null }
    profilesResponse = { data: [], error: null }
  })

  it('条件が無ければ余計な絞り込みをしない', async () => {
    await callGet(SPACE_ID)
    expect(filesOrArgs).toEqual([])
  })

  it('q はファイル名と説明文の両方にあたる', async () => {
    await callGet(SPACE_ID, { q: '請求' })
    expect(filesOrArgs).toHaveLength(1)
    // 値はダブルクォートで包む(PostgREST の or= はカンマ・ピリオドで構文が決まるため)
    expect(filesOrArgs[0]).toContain('name.ilike."%請求%"')
    expect(filesOrArgs[0]).toContain('description.ilike."%請求%"')
  })

  it('q の中の % と _ はそのまま検索語として扱う(全件一致にしない)', async () => {
    await callGet(SPACE_ID, { q: '100%' })
    expect(filesOrArgs[0]).toContain('100\\%')
  })

  it('長すぎる q は 400 で弾く', async () => {
    const res = await callGet(SPACE_ID, { q: 'あ'.repeat(201) })
    expect(res.status).toBe(400)
  })

  it('kind は MIME と拡張子の両方で拾う', async () => {
    await callGet(SPACE_ID, { kind: 'table' })
    expect(filesOrArgs).toHaveLength(1)
    expect(filesOrArgs[0]).toContain('mime_type.ilike."%text/csv%"')
    expect(filesOrArgs[0]).toContain('name.ilike."%.csv"')
  })

  it('kind=other は SQL では絞らない(列挙できないため)', async () => {
    await callGet(SPACE_ID, { kind: 'other' })
    expect(filesOrArgs).toEqual([])
  })

  it('知らない kind は 400 で弾く', async () => {
    const res = await callGet(SPACE_ID, { kind: 'unknown-kind' })
    expect(res.status).toBe(400)
  })

  it('公開状態: 公開中はクライアント提供ファイルも含む', async () => {
    await callGet(SPACE_ID, { visibility: 'visible' })
    expect(filesOrArgs).toHaveLength(1)
    expect(filesOrArgs[0]).toContain('client_visible.eq.true')
    expect(filesOrArgs[0]).toContain('origin.eq.client')
  })

  it('公開状態: 非公開は client_visible=false かつ 社内提供', async () => {
    await callGet(SPACE_ID, { visibility: 'hidden' })
    expect(filesEqArgs).toEqual(
      expect.arrayContaining([['client_visible', false], ['origin', 'internal']])
    )
  })

  it('提供元で絞れる', async () => {
    await callGet(SPACE_ID, { origin: 'client' })
    expect(filesEqArgs).toEqual(expect.arrayContaining([['origin', 'client']]))
  })

  it('上限より1件多く取り、多ければ hasMore=true にして上限ぶんだけ返す', async () => {
    filesListResponse = {
      data: Array.from({ length: FILES_LIST_LIMIT + 1 }, (_, i) => ({
        id: `file-${i}`,
        name: `f${i}.pdf`,
        mime_type: 'application/pdf',
        size_bytes: 1,
        origin: 'internal',
        client_visible: false,
        uploaded_by: UPLOADER_ID,
        description: null,
        created_at: '2026-07-07T00:00:00.000Z',
      })),
      error: null,
    }
    const res = await callGet(SPACE_ID)
    const data = await res.json()

    expect(filesLimitArg).toBe(FILES_LIST_LIMIT + 1)
    expect(data.files).toHaveLength(FILES_LIST_LIMIT)
    expect(data.hasMore).toBe(true)
  })

  it('上限ちょうどなら hasMore=false', async () => {
    filesListResponse = {
      data: Array.from({ length: FILES_LIST_LIMIT }, (_, i) => ({
        id: `file-${i}`,
        name: `f${i}.pdf`,
        mime_type: 'application/pdf',
        size_bytes: 1,
        origin: 'internal',
        client_visible: false,
        uploaded_by: UPLOADER_ID,
        description: null,
        created_at: '2026-07-07T00:00:00.000Z',
      })),
      error: null,
    }
    const res = await callGet(SPACE_ID)
    const data = await res.json()
    expect(data.files).toHaveLength(FILES_LIST_LIMIT)
    expect(data.hasMore).toBe(false)
  })
})
