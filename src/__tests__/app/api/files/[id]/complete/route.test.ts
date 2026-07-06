import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST /api/files/[id]/complete — アップロード完了確認。
 * - 呼び出し元が uploaded_by 本人であること
 * - Storage上に実体が存在することを確認してから status='ready' に更新
 * - origin='client' の場合のみ内部メンバーへ通知(二重実行しても複数回通知しない)
 */

const FILE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SPACE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ORG_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const UPLOADER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const OTHER_USER_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const INTERNAL_MEMBER_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff'

const mockUser = { id: UPLOADER_ID }

let authResponse: { data: { user: typeof mockUser | null } }
let fileSelectResponse: { data: Record<string, unknown> | null; error: { message: string } | null }
let fileUpdateResponse: { data: { id: string } | null; error: { message: string } | null }
let storageListResponse: { data: Array<{ name: string }> | null; error: { message: string } | null }
let internalMembersResponse: { data: Array<{ user_id: string }> | null; error: null }
let profileResponse: { data: { display_name: string } | null; error: null }
let notificationInsertResponse: { data: null; error: { message: string } | null }

let fileUpdateCall: Record<string, unknown> | undefined
let notificationInsertCall: Array<Record<string, unknown>> | undefined
let storageListPath: string | undefined

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chain(response: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {}
  for (const m of ['select', 'eq', 'neq', 'in', 'order', 'limit', 'delete']) {
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
        if (table === 'files') {
          const builder = chain(fileSelectResponse)
          builder.update = vi.fn((args: Record<string, unknown>) => {
            fileUpdateCall = args
            return chain(fileUpdateResponse)
          })
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
        list: vi.fn((path: string) => {
          storageListPath = path
          return Promise.resolve(storageListResponse)
        }),
      })),
    },
    from: vi.fn((table: string) => {
      if (table === 'space_memberships') return chain(internalMembersResponse)
      if (table === 'profiles') return chain(profileResponse)
      if (table === 'notifications') {
        const builder = chain(notificationInsertResponse)
        builder.insert = vi.fn((args: Array<Record<string, unknown>>) => {
          notificationInsertCall = args
          return Promise.resolve(notificationInsertResponse)
        })
        return builder
      }
      throw new Error(`Unexpected admin table: ${table}`)
    }),
  })),
}))

const { POST } = await import('@/app/api/files/[id]/complete/route')

function callPost(id: string) {
  const request = new NextRequest(new URL(`/api/files/${id}/complete`, 'http://localhost:3000'), {
    method: 'POST',
  })
  return POST(request, { params: Promise.resolve({ id }) })
}

const baseFile = {
  id: FILE_ID,
  uploaded_by: UPLOADER_ID,
  org_id: ORG_ID,
  space_id: SPACE_ID,
  origin: 'internal',
  client_visible: false,
  name: '議事録.pdf',
  storage_path: `${SPACE_ID}/${FILE_ID}/議事録.pdf`,
  status: 'pending',
}

describe('POST /api/files/[id]/complete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fileUpdateCall = undefined
    notificationInsertCall = undefined
    storageListPath = undefined

    authResponse = { data: { user: mockUser } }
    fileSelectResponse = { data: { ...baseFile }, error: null }
    fileUpdateResponse = { data: { id: FILE_ID }, error: null }
    storageListResponse = { data: [{ name: '議事録.pdf' }], error: null }
    internalMembersResponse = { data: [{ user_id: INTERNAL_MEMBER_ID }], error: null }
    profileResponse = { data: { display_name: 'アップローダー' }, error: null }
    notificationInsertResponse = { data: null, error: null }
  })

  it('returns 401 when not authenticated', async () => {
    authResponse = { data: { user: null } }
    const response = await callPost(FILE_ID)
    expect(response.status).toBe(401)
  })

  it('returns 400 for a malformed file id', async () => {
    const response = await callPost('not-a-uuid')
    expect(response.status).toBe(400)
  })

  it('returns 404 when the file does not exist', async () => {
    fileSelectResponse = { data: null, error: { message: 'not found' } }
    const response = await callPost(FILE_ID)
    expect(response.status).toBe(404)
  })

  it('returns 403 when the caller is not the uploader', async () => {
    fileSelectResponse = { data: { ...baseFile, uploaded_by: OTHER_USER_ID }, error: null }
    const response = await callPost(FILE_ID)
    expect(response.status).toBe(403)
  })

  it('returns 400 when the storage object does not exist yet', async () => {
    storageListResponse = { data: [], error: null }
    const response = await callPost(FILE_ID)
    expect(response.status).toBe(400)
    expect(storageListPath).toBe(`${SPACE_ID}/${FILE_ID}`)
  })

  it('returns 500 when the storage list call fails', async () => {
    storageListResponse = { data: null, error: { message: 'storage error' } }
    const response = await callPost(FILE_ID)
    expect(response.status).toBe(500)
  })

  it('marks the file ready and does not notify for internal-origin files', async () => {
    const response = await callPost(FILE_ID)
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.ok).toBe(true)
    expect(fileUpdateCall).toMatchObject({ status: 'ready' })
    expect(notificationInsertCall).toBeUndefined()
  })

  it('notifies internal members when origin=client', async () => {
    fileSelectResponse = { data: { ...baseFile, origin: 'client', client_visible: true }, error: null }
    const response = await callPost(FILE_ID)
    expect(response.status).toBe(200)
    expect(notificationInsertCall).toHaveLength(1)
    expect(notificationInsertCall?.[0]).toMatchObject({
      org_id: ORG_ID,
      space_id: SPACE_ID,
      to_user_id: INTERNAL_MEMBER_ID,
      channel: 'in_app',
      type: 'file_uploaded',
      dedupe_key: `file_uploaded:${FILE_ID}:${INTERNAL_MEMBER_ID}`,
    })
  })

  it('returns 500 when the status update fails', async () => {
    fileUpdateResponse = { data: null, error: { message: 'db error' } }
    const response = await callPost(FILE_ID)
    expect(response.status).toBe(500)
  })

  it('is idempotent: calling twice does not send a second notification', async () => {
    fileSelectResponse = { data: { ...baseFile, origin: 'client', client_visible: true, status: 'ready' }, error: null }
    const response = await callPost(FILE_ID)
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.ok).toBe(true)
    expect(notificationInsertCall).toBeUndefined()
    expect(fileUpdateCall).toBeUndefined()
  })

  it('still returns 200 when the notification insert fails (non-fatal)', async () => {
    fileSelectResponse = { data: { ...baseFile, origin: 'client', client_visible: true }, error: null }
    notificationInsertResponse = { data: null, error: { message: 'db error' } }
    const response = await callPost(FILE_ID)
    expect(response.status).toBe(200)
  })
})
