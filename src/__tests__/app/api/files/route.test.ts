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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chain(response: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {}
  for (const m of ['select', 'eq', 'neq', 'in', 'order', 'limit', 'insert', 'update', 'upsert', 'delete']) {
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
        if (table === 'files') return chain(filesListResponse)
        if (table === 'profiles') return chain(profilesResponse)
        throw new Error(`Unexpected table: ${table}`)
      }),
    })
  ),
}))

const { GET } = await import('@/app/api/files/route')

function callGet(spaceId?: string) {
  const url = new URL('/api/files', 'http://localhost:3000')
  if (spaceId !== undefined) url.searchParams.set('spaceId', spaceId)
  return GET(new NextRequest(url))
}

describe('GET /api/files', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
      createdAt: '2026-07-07T00:00:00.000Z',
    })
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
