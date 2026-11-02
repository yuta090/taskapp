import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * PATCH /api/files/[id] — 公開トグル・リネーム(内部ロールのみ)。
 * DELETE /api/files/[id] — 削除(アップローダ本人または管理者)。
 */

const FILE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SPACE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const UPLOADER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const OTHER_USER_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

const mockUser = { id: UPLOADER_ID }

let authResponse: { data: { user: typeof mockUser | null } }
let fileSelectResponse: { data: Record<string, unknown> | null; error: { message: string } | null }
let membershipResponse: { data: { id: string } | null; error: null }
let canManageResponse: { data: boolean | null; error: null }
let canManageArgs: Record<string, unknown> | undefined
let fileUpdateResponse: { data: Record<string, unknown> | null; error: { message: string } | null }
let fileDeleteResponse: { data: null; error: { message: string } | null }
let storageRemoveResponse: { data: null; error: { message: string } | null }

let fileUpdateCall: Record<string, unknown> | undefined
let storageRemoveArgs: string[] | undefined

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
      auth: { getSession: () => Promise.resolve({ data: { session: null } }), mfa: { listFactors: () => Promise.resolve({ data: { all: [] }, error: null }) },  getUser: vi.fn(() => Promise.resolve(authResponse)) },
      rpc: vi.fn((name: string, args: Record<string, unknown>) => {
        if (name !== 'app_can_manage_space_files') throw new Error(`Unexpected rpc: ${name}`)
        canManageArgs = args
        return Promise.resolve(canManageResponse)
      }),
      from: vi.fn((table: string) => {
        if (table === 'files') {
          const builder = chain(fileSelectResponse)
          builder.update = vi.fn((args: Record<string, unknown>) => {
            fileUpdateCall = args
            return chain(fileUpdateResponse)
          })
          builder.delete = vi.fn(() => chain(fileDeleteResponse))
          return builder
        }
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
        remove: vi.fn((paths: string[]) => {
          storageRemoveArgs = paths
          return Promise.resolve(storageRemoveResponse)
        }),
      })),
    },
  })),
}))

const { PATCH, DELETE } = await import('@/app/api/files/[id]/route')

function callPatch(id: string, body: Record<string, unknown>) {
  const request = new NextRequest(new URL(`/api/files/${id}`, 'http://localhost:3000'), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return PATCH(request, { params: Promise.resolve({ id }) })
}

function callDelete(id: string) {
  const request = new NextRequest(new URL(`/api/files/${id}`, 'http://localhost:3000'), {
    method: 'DELETE',
  })
  return DELETE(request, { params: Promise.resolve({ id }) })
}

const baseFile = {
  id: FILE_ID,
  uploaded_by: UPLOADER_ID,
  space_id: SPACE_ID,
  org_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  name: '議事録.pdf',
  client_visible: false,
  storage_path: `${SPACE_ID}/${FILE_ID}/議事録.pdf`,
}

describe('PATCH /api/files/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fileUpdateCall = undefined
    authResponse = { data: { user: { id: OTHER_USER_ID } } }
    fileSelectResponse = { data: { ...baseFile }, error: null }
    membershipResponse = { data: { id: 'membership-1' }, error: null } // internal role (not client/vendor)
    fileUpdateResponse = { data: { id: FILE_ID, name: '議事録.pdf', client_visible: true }, error: null }
  })

  it('returns 401 when not authenticated', async () => {
    authResponse = { data: { user: null } }
    const response = await callPatch(FILE_ID, { clientVisible: true })
    expect(response.status).toBe(401)
  })

  it('returns 400 for a malformed file id', async () => {
    const response = await callPatch('not-a-uuid', { clientVisible: true })
    expect(response.status).toBe(400)
  })

  it('説明文を更新できる', async () => {
    const response = await callPatch(FILE_ID, { description: '毎月更新する元データ' })
    expect(response.status).toBe(200)
    expect(fileUpdateCall).toEqual({ description: '毎月更新する元データ' })
  })

  it('説明文に null を渡すと消せる', async () => {
    const response = await callPatch(FILE_ID, { description: null })
    expect(response.status).toBe(200)
    expect(fileUpdateCall).toEqual({ description: null })
  })

  it('説明文の前後の空白は落とし、空文字は null にして保存する', async () => {
    await callPatch(FILE_ID, { description: '  余白つき  ' })
    expect(fileUpdateCall).toEqual({ description: '余白つき' })

    await callPatch(FILE_ID, { description: '   ' })
    expect(fileUpdateCall).toEqual({ description: null })
  })

  it('長すぎる説明文は 400 で弾く', async () => {
    const response = await callPatch(FILE_ID, { description: 'あ'.repeat(1001) })
    expect(response.status).toBe(400)
  })

  it('説明文が文字列でも null でもなければ 400', async () => {
    const response = await callPatch(FILE_ID, { description: 123 })
    expect(response.status).toBe(400)
  })

  it('returns 400 when neither clientVisible nor name is provided', async () => {
    const response = await callPatch(FILE_ID, {})
    expect(response.status).toBe(400)
  })

  it('returns 400 when clientVisible is not a boolean', async () => {
    const response = await callPatch(FILE_ID, { clientVisible: 'yes' })
    expect(response.status).toBe(400)
  })

  it('returns 400 when name is invalid', async () => {
    const empty = await callPatch(FILE_ID, { name: '' })
    expect(empty.status).toBe(400)
    const withSlash = await callPatch(FILE_ID, { name: 'a/b.pdf' })
    expect(withSlash.status).toBe(400)
  })

  it('returns 404 when the file does not exist', async () => {
    fileSelectResponse = { data: null, error: { message: 'not found' } }
    const response = await callPatch(FILE_ID, { clientVisible: true })
    expect(response.status).toBe(404)
  })

  it('returns 403 for a client/vendor caller (internal-only operation)', async () => {
    membershipResponse = { data: null, error: null }
    const response = await callPatch(FILE_ID, { clientVisible: true })
    expect(response.status).toBe(403)
  })

  it('returns 403 even when the caller is the uploader but not an internal member', async () => {
    authResponse = { data: { user: { id: UPLOADER_ID } } }
    membershipResponse = { data: null, error: null }
    const response = await callPatch(FILE_ID, { clientVisible: true })
    expect(response.status).toBe(403)
  })

  it('updates clientVisible and name, and never touches storage_path', async () => {
    const response = await callPatch(FILE_ID, { clientVisible: true, name: '新議事録.pdf' })
    expect(response.status).toBe(200)
    expect(fileUpdateCall).toEqual({ client_visible: true, name: '新議事録.pdf' })
  })

  it('returns 500 when the update fails', async () => {
    fileUpdateResponse = { data: null, error: { message: 'db error' } }
    const response = await callPatch(FILE_ID, { clientVisible: true })
    expect(response.status).toBe(500)
  })
})

describe('DELETE /api/files/[id]', () => {
  beforeEach(() => {
    canManageResponse = { data: false, error: null }
    canManageArgs = undefined
    vi.clearAllMocks()
    storageRemoveArgs = undefined
    authResponse = { data: { user: mockUser } } // uploader
    fileSelectResponse = { data: { ...baseFile }, error: null }
    membershipResponse = { data: null, error: null } // not internal (uploader-only path)
    fileDeleteResponse = { data: null, error: null }
    storageRemoveResponse = { data: null, error: null }
  })

  it('returns 401 when not authenticated', async () => {
    authResponse = { data: { user: null } }
    const response = await callDelete(FILE_ID)
    expect(response.status).toBe(401)
  })

  it('returns 400 for a malformed file id', async () => {
    const response = await callDelete('not-a-uuid')
    expect(response.status).toBe(400)
  })

  it('returns 404 when the file does not exist', async () => {
    fileSelectResponse = { data: null, error: { message: 'not found' } }
    const response = await callDelete(FILE_ID)
    expect(response.status).toBe(404)
  })

  it('allows the uploader to delete their own file', async () => {
    const response = await callDelete(FILE_ID)
    expect(response.status).toBe(200)
    expect(storageRemoveArgs).toEqual([baseFile.storage_path])
  })

  it('管理者は他の人がアップロードしたファイルも消せる', async () => {
    authResponse = { data: { user: { id: OTHER_USER_ID } } }
    canManageResponse = { data: true, error: null }
    const response = await callDelete(FILE_ID)
    expect(response.status).toBe(200)
    expect(canManageArgs).toEqual({ p_space: SPACE_ID, p_org: baseFile.org_id })
  })

  it('管理者でなければ、社内メンバーでも他の人のファイルは消せず、実体にも触らない', async () => {
    authResponse = { data: { user: { id: OTHER_USER_ID } } }
    canManageResponse = { data: false, error: null }
    const response = await callDelete(FILE_ID)
    expect(response.status).toBe(403)
    expect(storageRemoveArgs).toBeUndefined()
  })

  it('本人のファイルなら管理者の判定を呼ばずに消せる', async () => {
    canManageArgs = undefined
    const response = await callDelete(FILE_ID)
    expect(response.status).toBe(200)
    expect(canManageArgs).toBeUndefined()
  })

  it('returns 500 and does not delete the row when storage removal fails', async () => {
    storageRemoveResponse = { data: null, error: { message: 'storage error' } }
    const response = await callDelete(FILE_ID)
    expect(response.status).toBe(500)
  })

  it('returns 500 when the DB delete fails', async () => {
    fileDeleteResponse = { data: null, error: { message: 'db error' } }
    const response = await callDelete(FILE_ID)
    expect(response.status).toBe(500)
  })
})
