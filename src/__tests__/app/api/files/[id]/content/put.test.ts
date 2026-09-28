// @vitest-environment node
// jsdom の Blob には arrayBuffer が無いため、API route のテストは Node 環境で回す
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * PUT /api/files/[id]/content — 表として直した中身で、同じファイルを書き換える。
 *
 * - 直せるのは社内メンバーだけ(相手先 client/vendor は 403)
 * - 保存は必ず「基準の updated_at」付き。ズレていたら 409 で止める(黙って上書きしない)
 * - 先に DB(files 行)を押さえてから Storage を書く。逆にすると、競合に気づく前に
 *   相手のバイトを上書きしてしまう
 * - Storage の書き込みに失敗したときも、やり直せるよう新しい updated_at を返す
 */

const FILE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SPACE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const BASE_UPDATED_AT = '2026-09-17T00:00:00.000Z'
const NEXT_UPDATED_AT = '2026-09-17T01:23:45.000Z'
const mockUser = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }

let authResponse: { data: { user: typeof mockUser | null } }
let fileSelectResponse: { data: Record<string, unknown> | null; error: { message: string } | null }
let membershipResponse: { data: Record<string, unknown> | null; error: { message: string } | null }
let fileUpdateResponse: { data: Array<Record<string, unknown>> | null; error: { message: string } | null }
let uploadResponse: { data: Record<string, unknown> | null; error: { message: string } | null }

let updateValues: Record<string, unknown> | undefined
let updateFilters: Array<[string, unknown]>
let uploadArgs: { path?: string; body?: ArrayBuffer | Uint8Array; options?: Record<string, unknown> }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chain(selectResponse: any, updateResponse?: any, opts: { track?: boolean } = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {}
  let isUpdate = false
  for (const m of ['neq', 'in', 'order', 'limit']) {
    builder[m] = vi.fn(() => builder)
  }
  builder.eq = vi.fn((column: string, value: unknown) => {
    if (opts.track && isUpdate) updateFilters.push([column, value])
    return builder
  })
  builder.select = vi.fn(() => builder)
  builder.update = vi.fn((values: Record<string, unknown>) => {
    isUpdate = true
    if (opts.track) updateValues = values
    return builder
  })
  builder.single = vi.fn(() => Promise.resolve(selectResponse))
  builder.maybeSingle = vi.fn(() => Promise.resolve(selectResponse))
  // .select() で終わる更新チェーンを await できるようにする
  builder.then = (
    resolve: (value: unknown) => unknown,
    reject: (reason: unknown) => unknown
  ) => Promise.resolve(isUpdate ? updateResponse : selectResponse).then(resolve, reject)
  return builder
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: {
        getSession: () => Promise.resolve({ data: { session: null } }),
        mfa: { listFactors: () => Promise.resolve({ data: { all: [] }, error: null }) },
        getUser: vi.fn(() => Promise.resolve(authResponse)),
      },
      from: vi.fn((table: string) => {
        if (table === 'files') return chain(fileSelectResponse, fileUpdateResponse, { track: true })
        if (table === 'space_memberships') return chain(membershipResponse)
        throw new Error(`Unexpected table: ${table}`)
      }),
    })
  ),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn((path: string, body: ArrayBuffer | Uint8Array, options: Record<string, unknown>) => {
          uploadArgs = { path, body, options }
          return Promise.resolve(uploadResponse)
        }),
      })),
    },
  })),
}))

const { PUT } = await import('@/app/api/files/[id]/content/route')
const { MAX_TABLE_FILE_BYTES } = await import('@/lib/table/tableModel')

function callPut(
  id: string,
  body: string | Uint8Array,
  headers: Record<string, string> = { 'x-base-updated-at': BASE_UPDATED_AT }
) {
  const request = new NextRequest(new URL(`/api/files/${id}/content`, 'http://localhost:3000'), {
    method: 'PUT',
    headers,
    body: typeof body === 'string' ? body : new Uint8Array(body),
  })
  return PUT(request, { params: Promise.resolve({ id }) })
}

function readyCsvFile(overrides: Record<string, unknown> = {}) {
  return {
    id: FILE_ID,
    space_id: SPACE_ID,
    name: 'ターゲット一覧.csv',
    mime_type: 'text/csv',
    size_bytes: 1234,
    status: 'ready',
    storage_path: `${SPACE_ID}/${FILE_ID}/target.csv`,
    ...overrides,
  }
}

describe('PUT /api/files/[id]/content', () => {
  beforeEach(() => {
    authResponse = { data: { user: mockUser } }
    fileSelectResponse = { data: readyCsvFile(), error: null }
    membershipResponse = { data: { id: 'membership-1' }, error: null }
    fileUpdateResponse = { data: [{ id: FILE_ID, updated_at: NEXT_UPDATED_AT }], error: null }
    uploadResponse = { data: { path: 'ok' }, error: null }
    updateValues = undefined
    updateFilters = []
    uploadArgs = {}
  })

  it('未ログインは 401', async () => {
    authResponse = { data: { user: null } }
    expect((await callPut(FILE_ID, 'a,b\r\n1,2')).status).toBe(401)
  })

  it('ID が UUID でなければ 400', async () => {
    expect((await callPut('not-a-uuid', 'a,b')).status).toBe(400)
  })

  it('基準の updated_at が無いときは 400(黙って上書きしない)', async () => {
    expect((await callPut(FILE_ID, 'a,b', {})).status).toBe(400)
  })

  it('中身が空のときは 400', async () => {
    expect((await callPut(FILE_ID, '')).status).toBe(400)
  })

  it('見えない・存在しないファイルは 404', async () => {
    fileSelectResponse = { data: null, error: { message: 'not found' } }
    expect((await callPut(FILE_ID, 'a,b')).status).toBe(404)
  })

  it('アップロード未完了(ready でない)は 404', async () => {
    fileSelectResponse = { data: readyCsvFile({ status: 'pending' }), error: null }
    expect((await callPut(FILE_ID, 'a,b')).status).toBe(404)
  })

  it('表として扱えないファイルは 415', async () => {
    fileSelectResponse = { data: readyCsvFile({ name: '資料.pdf', mime_type: 'application/pdf' }), error: null }
    expect((await callPut(FILE_ID, 'a,b')).status).toBe(415)
  })

  it('相手先(client/vendor)は直せない → 403', async () => {
    membershipResponse = { data: null, error: { message: 'no rows' } }
    const res = await callPut(FILE_ID, 'a,b')
    expect(res.status).toBe(403)
    expect(uploadArgs.path).toBeUndefined()
  })

  it('上限(4MB)を超える中身は 413', async () => {
    const tooBig = new Uint8Array(MAX_TABLE_FILE_BYTES + 1).fill(97)
    const res = await callPut(FILE_ID, tooBig)
    expect(res.status).toBe(413)
    expect(uploadArgs.path).toBeUndefined()
  })

  it('保存できたら、Storage を上書きして新しい updated_at を返す', async () => {
    const res = await callPut(FILE_ID, 'a,b\r\n1,2')
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ updatedAt: NEXT_UPDATED_AT, sizeBytes: 8 })

    // 同じ置き場所を上書きする(新しいファイルを作らない)
    expect(uploadArgs.path).toBe(`${SPACE_ID}/${FILE_ID}/target.csv`)
    expect(uploadArgs.options).toMatchObject({ upsert: true })

    // 一覧のサイズ表示と、表ビューの上限判定がずれないよう size_bytes も更新する
    expect(updateValues).toMatchObject({ size_bytes: 8 })
  })

  it('基準の updated_at を条件に付けて更新する(合言葉)', async () => {
    await callPut(FILE_ID, 'a,b\r\n1,2')
    expect(updateFilters).toContainEqual(['id', FILE_ID])
    expect(updateFilters).toContainEqual(['updated_at', BASE_UPDATED_AT])
  })

  it('先に別の人が保存していたら 409 で止め、Storage は書かない', async () => {
    fileUpdateResponse = { data: [], error: null }
    const res = await callPut(FILE_ID, 'a,b\r\n1,2')
    expect(res.status).toBe(409)
    expect(uploadArgs.path).toBeUndefined()
  })

  it('Storage の書き込みに失敗したら 500。やり直せるよう新しい updated_at を返す', async () => {
    uploadResponse = { data: null, error: { message: 'storage down' } }
    const res = await callPut(FILE_ID, 'a,b\r\n1,2')
    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toMatchObject({ updatedAt: NEXT_UPDATED_AT })
  })
})
