import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * GET /api/files/[id]/download — 署名URLへの302リダイレクト。
 * - RLSで見えない/存在しない/pendingのファイルは404
 * - 署名URL発行はservice roleで行う(安定したWikiリンク先として使われる)
 */

const FILE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

const mockUser = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }

let authResponse: { data: { user: typeof mockUser | null } }
let fileSelectResponse: { data: Record<string, unknown> | null; error: { message: string } | null }
let signedUrlResponse: { data: { signedUrl: string } | null; error: { message: string } | null }

let createSignedUrlArgs: unknown[] | undefined

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chain(response: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {}
  for (const m of ['select', 'eq', 'neq', 'in', 'order', 'limit']) {
    builder[m] = vi.fn(() => builder)
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
        createSignedUrl: vi.fn((...args: unknown[]) => {
          createSignedUrlArgs = args
          return Promise.resolve(signedUrlResponse)
        }),
      })),
    },
  })),
}))

const { GET } = await import('@/app/api/files/[id]/download/route')

function callGet(id: string) {
  const request = new NextRequest(new URL(`/api/files/${id}/download`, 'http://localhost:3000'))
  return GET(request, { params: Promise.resolve({ id }) })
}

describe('GET /api/files/[id]/download', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createSignedUrlArgs = undefined
    authResponse = { data: { user: mockUser } }
    fileSelectResponse = {
      data: { id: FILE_ID, name: '議事録.pdf', status: 'ready', storage_path: `space-1/${FILE_ID}/議事録.pdf` },
      error: null,
    }
    signedUrlResponse = { data: { signedUrl: 'https://example.com/download-signed' }, error: null }
  })

  it('returns 401 when not authenticated', async () => {
    authResponse = { data: { user: null } }
    const response = await callGet(FILE_ID)
    expect(response.status).toBe(401)
  })

  it('returns 400 for a malformed file id', async () => {
    const response = await callGet('not-a-uuid')
    expect(response.status).toBe(400)
  })

  it('returns 404 when the file is not visible (RLS) or does not exist', async () => {
    fileSelectResponse = { data: null, error: { message: 'not found' } }
    const response = await callGet(FILE_ID)
    expect(response.status).toBe(404)
  })

  it('returns 404 when the file is still pending', async () => {
    fileSelectResponse = { data: { ...fileSelectResponse.data, status: 'pending' }, error: null }
    const response = await callGet(FILE_ID)
    expect(response.status).toBe(404)
  })

  it('returns 500 when signed URL creation fails', async () => {
    signedUrlResponse = { data: null, error: { message: 'storage error' } }
    const response = await callGet(FILE_ID)
    expect(response.status).toBe(500)
  })

  it('redirects (302) to the signed URL with a download filename', async () => {
    const response = await callGet(FILE_ID)
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://example.com/download-signed')
    expect(createSignedUrlArgs?.[0]).toBe(`space-1/${FILE_ID}/議事録.pdf`)
    expect(createSignedUrlArgs?.[2]).toMatchObject({ download: '議事録.pdf' })
  })
})
