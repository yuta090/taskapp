import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST /api/files/upload-url — 署名アップロードURL発行。
 * - スペースメンバーであることを確認
 * - client/vendor は origin='client' かつ client_visible=true を強制
 * - 内部ロールは origin='internal' かつ client_visible=false
 */

const SPACE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const USER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const ORG_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'

const mockUser = { id: USER_ID }

let authResponse: { data: { user: typeof mockUser | null } }
let membershipResponse: { data: { role: string } | null; error: null }
let spaceResponse: { data: { org_id: string } | null; error: null }
let fileInsertResponse: { data: { id: string } | null; error: { message: string } | null }
let signedUploadUrlResponse: { data: { signedUrl: string; token: string; path: string } | null; error: { message: string } | null }

let fileInsertCall: Record<string, unknown> | undefined
let createSignedUploadUrlCall: string | undefined

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chain(response: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {}
  for (const m of ['select', 'eq', 'neq', 'in', 'order', 'limit', 'update', 'upsert', 'delete']) {
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
        if (table === 'space_memberships') return chain(membershipResponse)
        if (table === 'spaces') return chain(spaceResponse)
        if (table === 'files') {
          const builder = chain(fileInsertResponse)
          builder.insert = vi.fn((args: Record<string, unknown>) => {
            fileInsertCall = args
            return chain(fileInsertResponse)
          })
          builder.delete = vi.fn(() => chain({ data: null, error: null }))
          return builder
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    })
  ),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    storage: {
      from: vi.fn(() => ({
        createSignedUploadUrl: vi.fn((path: string) => {
          createSignedUploadUrlCall = path
          return Promise.resolve(signedUploadUrlResponse)
        }),
      })),
    },
  })),
}))

const { POST } = await import('@/app/api/files/upload-url/route')

function callPost(body: Record<string, unknown>) {
  const request = new NextRequest(new URL('/api/files/upload-url', 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(request)
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    spaceId: SPACE_ID,
    name: '議事録.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    ...overrides,
  }
}

describe('POST /api/files/upload-url', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fileInsertCall = undefined
    createSignedUploadUrlCall = undefined

    authResponse = { data: { user: mockUser } }
    membershipResponse = { data: { role: 'editor' }, error: null }
    spaceResponse = { data: { org_id: ORG_ID }, error: null }
    fileInsertResponse = { data: { id: 'file-1' }, error: null }
    signedUploadUrlResponse = {
      data: { signedUrl: 'https://example.com/signed', token: 'tok-1', path: 'unused' },
      error: null,
    }
  })

  it('returns 401 when not authenticated', async () => {
    authResponse = { data: { user: null } }
    const response = await callPost(validBody())
    expect(response.status).toBe(401)
  })

  it('returns 400 when spaceId is missing or malformed', async () => {
    const response = await callPost(validBody({ spaceId: 'not-a-uuid' }))
    expect(response.status).toBe(400)
  })

  it('returns 400 when name is empty', async () => {
    const response = await callPost(validBody({ name: '' }))
    expect(response.status).toBe(400)
  })

  it('returns 400 when name exceeds 255 characters', async () => {
    const response = await callPost(validBody({ name: 'a'.repeat(256) }))
    expect(response.status).toBe(400)
  })

  it('returns 400 when name contains a path separator', async () => {
    const slash = await callPost(validBody({ name: '../secrets.pdf' }))
    expect(slash.status).toBe(400)
    const backslash = await callPost(validBody({ name: 'a\\b.pdf' }))
    expect(backslash.status).toBe(400)
  })

  it('returns 400 when sizeBytes is out of range', async () => {
    const zero = await callPost(validBody({ sizeBytes: 0 }))
    expect(zero.status).toBe(400)
    const tooLarge = await callPost(validBody({ sizeBytes: 52428801 }))
    expect(tooLarge.status).toBe(400)
  })

  it('returns 403 when the user has no membership in the space', async () => {
    membershipResponse = { data: null, error: null }
    const response = await callPost(validBody())
    expect(response.status).toBe(403)
  })

  it('returns 404 when the space does not exist', async () => {
    spaceResponse = { data: null, error: null }
    const response = await callPost(validBody())
    expect(response.status).toBe(404)
  })

  it('forces origin=client and clientVisible=true for a client role', async () => {
    membershipResponse = { data: { role: 'client' }, error: null }
    const response = await callPost(validBody())
    expect(response.status).toBe(200)
    expect(fileInsertCall).toMatchObject({ origin: 'client', client_visible: true })
  })

  it('forces origin=client and clientVisible=true for a vendor role', async () => {
    membershipResponse = { data: { role: 'vendor' }, error: null }
    const response = await callPost(validBody())
    expect(response.status).toBe(200)
    expect(fileInsertCall).toMatchObject({ origin: 'client', client_visible: true })
  })

  it('uses origin=internal and clientVisible=false for internal roles', async () => {
    membershipResponse = { data: { role: 'editor' }, error: null }
    const response = await callPost(validBody())
    expect(response.status).toBe(200)
    expect(fileInsertCall).toMatchObject({ origin: 'internal', client_visible: false })
  })

  it('inserts the file row with a pending status and derived storage_path', async () => {
    await callPost(validBody())
    expect(fileInsertCall).toMatchObject({
      org_id: ORG_ID,
      space_id: SPACE_ID,
      uploaded_by: USER_ID,
      name: '議事録.pdf',
      mime_type: 'application/pdf',
      size_bytes: 1024,
      status: 'pending',
    })
    expect(fileInsertCall?.storage_path).toMatch(new RegExp(`^${SPACE_ID}/.+/議事録\\.pdf$`))
  })

  it('returns 500 when the file insert fails', async () => {
    fileInsertResponse = { data: null, error: { message: 'db error' } }
    const response = await callPost(validBody())
    expect(response.status).toBe(500)
  })

  it('returns 500 and cleans up the row when signed URL creation fails', async () => {
    signedUploadUrlResponse = { data: null, error: { message: 'storage error' } }
    const response = await callPost(validBody())
    expect(response.status).toBe(500)
  })

  it('returns fileId, signedUrl, token, and path on success', async () => {
    const response = await callPost(validBody())
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.fileId).toBe('file-1')
    expect(data.signedUrl).toBe('https://example.com/signed')
    expect(data.token).toBe('tok-1')
    expect(typeof data.path).toBe('string')
    expect(createSignedUploadUrlCall).toBe(data.path)
  })
})
