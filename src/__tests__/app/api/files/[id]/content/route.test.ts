// @vitest-environment node
// jsdom の Blob には arrayBuffer が無いため、API route のテストは Node 環境で回す
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * GET /api/files/[id]/content — 表ビュー用にファイルの生バイトをそのまま返す。
 * - 見える/存在/ready の判定は download と同じ(RLS 経由・見えなければ404)
 * - 表として扱えるファイル(.csv/.tsv)以外は 415
 * - 上限(MAX_TABLE_FILE_BYTES)超えは 413(ブラウザで丸ごと読むため)
 * - 実バイトは service role で取り出す(署名URLのリダイレクトだと CORS に依存するため)
 */

const FILE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const mockUser = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }

let authResponse: { data: { user: typeof mockUser | null } }
let fileSelectResponse: { data: Record<string, unknown> | null; error: { message: string } | null }
let downloadResponse: { data: Blob | null; error: { message: string } | null }
let downloadPathArg: string | undefined

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chain(response: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {}
  for (const m of ['select', 'eq', 'neq', 'in', 'order', 'limit']) {
    builder[m] = vi.fn(() => builder)
  }
  builder.single = vi.fn(() => Promise.resolve(response))
  builder.maybeSingle = vi.fn(() => Promise.resolve(response))
  return builder
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: vi.fn(() => Promise.resolve(authResponse)) },
      from: vi.fn((table: string) => {
        if (table === 'files') return chain(fileSelectResponse)
        throw new Error(`Unexpected table: ${table}`)
      }),
    })
  ),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    storage: {
      from: vi.fn(() => ({
        download: vi.fn((path: string) => {
          downloadPathArg = path
          return Promise.resolve(downloadResponse)
        }),
      })),
    },
  })),
}))

const { GET } = await import('@/app/api/files/[id]/content/route')
const { MAX_TABLE_FILE_BYTES } = await import('@/lib/table/tableModel')

function callGet(id: string) {
  const request = new NextRequest(new URL(`/api/files/${id}/content`, 'http://localhost:3000'))
  return GET(request, { params: Promise.resolve({ id }) })
}

function readyCsvFile(overrides: Record<string, unknown> = {}) {
  return {
    id: FILE_ID,
    name: 'ターゲット一覧.csv',
    mime_type: 'text/csv',
    size_bytes: 1234,
    status: 'ready',
    storage_path: `space-1/${FILE_ID}/ターゲット一覧.csv`,
    ...overrides,
  }
}

describe('GET /api/files/[id]/content', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    downloadPathArg = undefined
    authResponse = { data: { user: mockUser } }
    fileSelectResponse = { data: readyCsvFile(), error: null }
    downloadResponse = { data: new Blob(['a,b\n1,2\n']), error: null }
  })

  it('未ログインは 401', async () => {
    authResponse = { data: { user: null } }
    const res = await callGet(FILE_ID)
    expect(res.status).toBe(401)
  })

  it('UUID でない id は 400', async () => {
    const res = await callGet('not-a-uuid')
    expect(res.status).toBe(400)
  })

  it('見えない/存在しないファイルは 404', async () => {
    fileSelectResponse = { data: null, error: { message: 'not found' } }
    const res = await callGet(FILE_ID)
    expect(res.status).toBe(404)
  })

  it('pending のファイルは 404', async () => {
    fileSelectResponse = { data: readyCsvFile({ status: 'pending' }), error: null }
    const res = await callGet(FILE_ID)
    expect(res.status).toBe(404)
  })

  it('表として扱えないファイル(PDF)は 415', async () => {
    fileSelectResponse = {
      data: readyCsvFile({ name: '議事録.pdf', mime_type: 'application/pdf' }),
      error: null,
    }
    const res = await callGet(FILE_ID)
    expect(res.status).toBe(415)
    expect(downloadPathArg).toBeUndefined()
  })

  it('上限を超えるサイズは 413 で、実バイトは取りにいかない', async () => {
    fileSelectResponse = { data: readyCsvFile({ size_bytes: MAX_TABLE_FILE_BYTES + 1 }), error: null }
    const res = await callGet(FILE_ID)
    expect(res.status).toBe(413)
    expect(downloadPathArg).toBeUndefined()
  })

  it('CSV は storage_path から実バイトを取り出して返す', async () => {
    const res = await callGet(FILE_ID)
    expect(res.status).toBe(200)
    expect(downloadPathArg).toBe(`space-1/${FILE_ID}/ターゲット一覧.csv`)
    expect(await res.text()).toBe('a,b\n1,2\n')
    // ブラウザに内容を推測させない・キャッシュは本人だけ
    expect(res.headers.get('content-type')).toBe('text/plain')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('cache-control')).toContain('private')
  })

  it('storage から取れなければ 500', async () => {
    downloadResponse = { data: null, error: { message: 'boom' } }
    const res = await callGet(FILE_ID)
    expect(res.status).toBe(500)
  })
})

describe('GET /api/files/[id]/content 実サイズの再確認', () => {
  it('DB の size_bytes が無くても、取り出した実バイトが上限を超えていれば 413', async () => {
    authResponse = { data: { user: mockUser } }
    fileSelectResponse = { data: readyCsvFile({ size_bytes: null }), error: null }
    downloadResponse = { data: new Blob([new Uint8Array(MAX_TABLE_FILE_BYTES + 1)]), error: null }
    const res = await callGet(FILE_ID)
    expect(res.status).toBe(413)
  })
})
