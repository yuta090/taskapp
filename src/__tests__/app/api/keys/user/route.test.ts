import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { createHash } from 'node:crypto'

/**
 * /api/keys/user — user-scoped API key management.
 *
 * Security-critical: a user must only be able to create keys scoped to
 * spaces they belong to, and must only be able to delete/list their own
 * keys (never another user's, even if the id is guessable).
 */

const USER_ID = 'user-1'
const OTHER_USER_ID = 'user-2'
const SPACE_A = 'space-a'
const SPACE_B = 'space-b'

const mockUser = { id: USER_ID }

let authResponse: { data: { user: typeof mockUser | null }; error: { message: string } | null }

let userSpacesResponse: {
  data: { space_id: string; role?: string; spaces: { org_id: string } | { org_id: string }[] }[] | null
  error: { message: string } | null
}
let insertResponse: { data: Record<string, unknown> | null; error: { message: string } | null }
let keyLookupResponse: { data: { user_id: string } | null; error: { message: string } | null }
let deleteResponse: { error: { message: string } | null }
let listResponse: { data: Record<string, unknown>[] | null; error: { message: string } | null }
/** api_keys に対する select の列指定（GET が何を返すかの確認用） */
let apiKeysSelectColumns: string[] = []
/** 選ばれたプロジェクトの所属確認で取った列（役割を取っているかの確認用） */
let accessibleSpaceColumns: string[] = []
/** space_memberships への .in() に渡された space_id の一覧（絞り込みの確認用） */
let inCallArgs: string[][] = []

const insertMock = vi.fn((_payload: Record<string, unknown>) => ({
  select: vi.fn(() => ({
    single: vi.fn(() => Promise.resolve(insertResponse)),
  })),
}))

const deleteEqMock = vi.fn(() => Promise.resolve(deleteResponse))
const deleteMock = vi.fn(() => ({ eq: deleteEqMock }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: { getSession: () => Promise.resolve({ data: { session: null } }), mfa: { listFactors: () => Promise.resolve({ data: { all: [] }, error: null }) }, 
        getUser: vi.fn(() => Promise.resolve(authResponse)),
      },
    })
  ),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table !== 'api_keys' && table !== 'space_memberships') return {}
      if (table === 'space_memberships') {
        return {
          // 選んだspaceの所属確認と、鍵の組織(org_id)の取得を1回のクエリで行う:
          // select('space_id, role, spaces(org_id)').eq(user_id).in(allowedSpaceIds)
          // .in() は実際に渡されたspace_idで絞り込む（呼び出し引数も記録する）ので、
          // userSpacesResponse.data に選んでいない別プロジェクトの行を混ぜても
          // それは絞り込まれて結果に含まれない
          select: vi.fn((columns: string) => {
            accessibleSpaceColumns.push(columns)
            return {
              eq: vi.fn(() => ({
                in: vi.fn((_column: string, ids: string[]) => {
                  inCallArgs.push(ids)
                  const allRows = userSpacesResponse.data ?? []
                  const filtered = allRows.filter((row) => ids.includes(row.space_id))
                  return Promise.resolve({ data: filtered, error: userSpacesResponse.error })
                }),
              })),
            }
          }),
        }
      }
      // api_keys
      return {
        insert: insertMock,
        select: vi.fn((columns: string) => {
          apiKeysSelectColumns.push(columns)
          if (columns.includes('user_id') && !columns.includes('allowed_space_ids')) {
            // DELETE lookup: select('user_id').eq(id).single()
            return {
              eq: vi.fn(() => ({
                single: vi.fn(() => Promise.resolve(keyLookupResponse)),
              })),
            }
          }
          // GET list: select(...).eq(user_id).order(...)
          return {
            eq: vi.fn(() => ({
              order: vi.fn(() => Promise.resolve(listResponse)),
            })),
          }
        }),
        delete: deleteMock,
      }
    }),
  })),
}))

const { POST, DELETE, GET } = await import('@/app/api/keys/user/route')

function callPost(body: Record<string, unknown>) {
  const request = new NextRequest(new URL('/api/keys/user', 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(request)
}

function callDelete(params: Record<string, string>) {
  const url = new URL('/api/keys/user', 'http://localhost:3000')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return DELETE(new NextRequest(url, { method: 'DELETE' }))
}

function callGet() {
  return GET(new NextRequest(new URL('/api/keys/user', 'http://localhost:3000'), { method: 'GET' }))
}

const basePostBody = {
  name: 'CLI Key',
  allowedSpaceIds: [SPACE_A],
  allowedActions: ['read'],
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-secret'

  authResponse = { data: { user: mockUser }, error: null }
  userSpacesResponse = { data: [{ space_id: SPACE_A, role: 'admin', spaces: { org_id: 'org-1' } }], error: null }
  insertResponse = {
    data: { id: 'key-1', user_id: USER_ID, allowed_space_ids: [SPACE_A] },
    error: null,
  }
  keyLookupResponse = { data: { user_id: USER_ID }, error: null }
  deleteResponse = { error: null }
  listResponse = { data: [{ id: 'key-1', name: 'CLI Key' }], error: null }
  apiKeysSelectColumns = []
  inCallArgs = []
})

describe('POST /api/keys/user', () => {
  it('returns 401 when there is no session', async () => {
    authResponse = { data: { user: null }, error: null }

    const response = await callPost(basePostBody)

    expect(response.status).toBe(401)
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('returns 400 when required fields are missing', async () => {
    const response = await callPost({ name: 'x', allowedSpaceIds: [] })

    expect(response.status).toBe(400)
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('returns 403 when requesting a space the user does not belong to', async () => {
    userSpacesResponse = { data: [], error: null } // SPACE_A not accessible

    const response = await callPost({ ...basePostBody, allowedSpaceIds: [SPACE_A, SPACE_B] })
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error).toBe('Access denied to some selected spaces')
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('creates the key scoped to the authenticated user', async () => {
    const response = await callPost(basePostBody)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.data).toEqual(insertResponse.data)
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: USER_ID, created_by: USER_ID, scope: 'user' })
    )
  })

  it('defaults allowed_actions to read-only when not specified', async () => {
    await callPost({ ...basePostBody, allowedActions: undefined })

    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({ allowed_actions: ['read'] }))
  })

  it('stores the chosen actions in a fixed order and always includes read', async () => {
    await callPost({ ...basePostBody, allowedActions: ['bulk', 'write'] })

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ allowed_actions: ['read', 'write', 'bulk'] })
    )
  })

  // プロジェクト設定側（/api/keys）と同じ検証。以前は知らない値を DB に渡し、CHECK 制約の文言を画面に返していた
  it('returns 400 for an unknown action and never passes it to the DB', async () => {
    const response = await callPost({ ...basePostBody, allowedActions: ['write', 'admin'] })

    expect(response.status).toBe(400)
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('returns a generic 500 without the DB error text when insert fails', async () => {
    insertResponse = { data: null, error: { message: 'new row violates check constraint "api_keys_allowed_actions_check"' } }

    const response = await callPost(basePostBody)
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Failed to create API key')
  })

  // API キーは社内メンバー（admin / editor / viewer）専用。相手先（client / vendor）として
  // 所属するプロジェクトが1つでも含まれていたら、全体を断る（一部だけ発行しない）
  it('returns 403 when a selected project is one the user belongs to as a client', async () => {
    userSpacesResponse = {
      data: [
        { space_id: SPACE_A, role: 'admin', spaces: { org_id: 'org-1' } },
        { space_id: SPACE_B, role: 'client', spaces: { org_id: 'org-1' } },
      ],
      error: null,
    }

    const response = await callPost({ ...basePostBody, allowedSpaceIds: [SPACE_A, SPACE_B] })

    expect(response.status).toBe(403)
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('returns 403 when a selected project is one the user belongs to as a vendor', async () => {
    userSpacesResponse = { data: [{ space_id: SPACE_A, role: 'vendor', spaces: { org_id: 'org-1' } }], error: null }

    const response = await callPost(basePostBody)

    expect(response.status).toBe(403)
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('reads the role of each selected project (so external memberships can be told apart)', async () => {
    accessibleSpaceColumns = []

    await callPost(basePostBody)

    const columns = (accessibleSpaceColumns.at(-1) ?? '').split(',').map((c) => c.trim())
    expect(columns).toEqual(expect.arrayContaining(['space_id', 'role']))
  })

  // 通す役割（admin / editor / viewer）を並べる判定。役割が分からない・新しい役割は断る側に倒す
  it('returns 403 when a selected project has an unknown role', async () => {
    userSpacesResponse = { data: [{ space_id: SPACE_A, role: 'guest', spaces: { org_id: 'org-1' } }], error: null }

    const response = await callPost(basePostBody)

    expect(response.status).toBe(403)
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('creates the key when every selected project is an internal membership', async () => {
    userSpacesResponse = {
      data: [
        { space_id: SPACE_A, role: 'editor', spaces: { org_id: 'org-1' } },
        { space_id: SPACE_B, role: 'viewer', spaces: { org_id: 'org-1' } },
      ],
      error: null,
    }

    const response = await callPost({ ...basePostBody, allowedSpaceIds: [SPACE_A, SPACE_B] })

    expect(response.status).toBe(200)
    expect(insertMock).toHaveBeenCalled()
  })
})

// 鍵の組織(org_id)は、選んだspaceそのものから決める
describe('POST /api/keys/user — the key\'s organization is derived from the selected spaces', () => {
  it('creates the key scoped to the organization of the selected space', async () => {
    userSpacesResponse = { data: [{ space_id: SPACE_A, role: 'admin', spaces: { org_id: 'org-selected' } }], error: null }

    const response = await callPost(basePostBody)

    expect(response.status).toBe(200)
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({ org_id: 'org-selected' }))
  })

  it('returns 400 when the selected spaces belong to different organizations', async () => {
    userSpacesResponse = {
      data: [
        { space_id: SPACE_A, role: 'admin', spaces: { org_id: 'org-1' } },
        { space_id: SPACE_B, role: 'admin', spaces: { org_id: 'org-2' } },
      ],
      error: null,
    }

    const response = await callPost({ ...basePostBody, allowedSpaceIds: [SPACE_A, SPACE_B] })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Selected projects must belong to the same organization')
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('only looks at the selected spaces, ignoring the organization of a membership the user has elsewhere', async () => {
    // ユーザーは SPACE_B(org-other) にも所属しているが、今回選んだのは SPACE_A(org-1) だけ
    userSpacesResponse = {
      data: [
        { space_id: SPACE_A, role: 'admin', spaces: { org_id: 'org-1' } },
        { space_id: SPACE_B, role: 'admin', spaces: { org_id: 'org-other' } },
      ],
      error: null,
    }

    const response = await callPost({ ...basePostBody, allowedSpaceIds: [SPACE_A] })

    expect(response.status).toBe(200)
    expect(inCallArgs.at(-1)).toEqual([SPACE_A])
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({ org_id: 'org-1' }))
  })
})

// APIキーは推測できない乱数からサーバー側で作る。画面（ブラウザ）から届いたキー・ハッシュは信用しない
describe('POST /api/keys/user — key generation happens on the server', () => {
  it('creates the key even when the browser sends no keyHash/keyPrefix at all', async () => {
    const response = await callPost({ name: 'CLI Key', allowedSpaceIds: [SPACE_A], allowedActions: ['read'] })

    expect(response.status).toBe(200)
    expect(insertMock).toHaveBeenCalled()
  })

  // 本番切り替え直後、開きっぱなしの古い画面（ブラウザ側でキーを作る旧版）が
  // 自分で作った keyHash/keyPrefix を送ってくることがある。黙って無視すると、
  // 画面に表示済みのキーが実際には保存されていない（＝使えない）という事故になるため、作らずに断る
  it('rejects with 400 and does not create a key when the browser sends keyHash', async () => {
    const response = await callPost({ ...basePostBody, keyHash: 'client-made-hash' })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toContain('再読み込み')
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('rejects with 400 and does not create a key when the browser sends keyPrefix', async () => {
    const response = await callPost({ ...basePostBody, keyPrefix: 'client_prefix' })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toContain('再読み込み')
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('returns a plaintext key (tsk_ + 32 alphanumerics) whose SHA-256 matches the stored hash', async () => {
    const response = await callPost(basePostBody)
    const data = await response.json()

    expect(data.key).toMatch(/^tsk_[A-Za-z0-9]{32}$/)
    const inserted = insertMock.mock.calls.at(-1)?.[0] as { key_hash: string }
    expect(inserted.key_hash).toBe(createHash('sha256').update(data.key).digest('hex'))
  })

  it('marks the response as non-cacheable, since it carries a one-time plaintext key', async () => {
    const response = await callPost(basePostBody)

    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it('generates a different key on every call', async () => {
    await callPost(basePostBody)
    const first = (insertMock.mock.calls.at(-1)?.[0] as { key_hash: string }).key_hash

    await callPost(basePostBody)
    const second = (insertMock.mock.calls.at(-1)?.[0] as { key_hash: string }).key_hash

    expect(first).not.toBe(second)
  })
})

describe('DELETE /api/keys/user', () => {
  it('returns 401 when there is no session', async () => {
    authResponse = { data: { user: null }, error: null }

    const response = await callDelete({ id: 'key-1' })

    expect(response.status).toBe(401)
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('returns 400 when id is missing', async () => {
    const response = await callDelete({})

    expect(response.status).toBe(400)
  })

  it('returns 404 when the key does not exist', async () => {
    keyLookupResponse = { data: null, error: { message: 'not found' } }

    const response = await callDelete({ id: 'missing-key' })

    expect(response.status).toBe(404)
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('returns 403 and does not delete another user\'s key', async () => {
    keyLookupResponse = { data: { user_id: OTHER_USER_ID }, error: null }

    const response = await callDelete({ id: 'key-1' })
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error).toBe('Access denied')
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('deletes the key when it belongs to the caller', async () => {
    const response = await callDelete({ id: 'key-1' })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(deleteMock).toHaveBeenCalled()
  })

  it('returns a generic 500 without the DB error text when delete fails', async () => {
    deleteResponse = { error: { message: 'db unreachable' } }

    const response = await callDelete({ id: 'key-1' })
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Failed to delete API key')
  })
})

describe('GET /api/keys/user', () => {
  it('returns 401 when there is no session', async () => {
    authResponse = { data: { user: null }, error: null }

    const response = await callGet()

    expect(response.status).toBe(401)
  })

  it("lists only the caller's own keys without leaking key_hash", async () => {
    const response = await callGet()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.data).toEqual(listResponse.data)
  })

  // プロジェクト設定で作ったキーにも持ち主が入り、この一覧に並ぶようになった。
  // allowed_space_ids が空なので、どのプロジェクトのキーかを返さないと「全スペース」と誤表示される
  it("returns each key's own project so project-settings keys are not shown as usable everywhere", async () => {
    await callGet()

    const columns = (apiKeysSelectColumns.at(-1) ?? '').split(',').map((c) => c.trim())
    expect(columns).toEqual(expect.arrayContaining(['scope', 'space_id', 'allowed_space_ids']))
  })

  it('returns a generic 500 without the DB error text on failure', async () => {
    listResponse = { data: null, error: { message: 'db unreachable' } }

    const response = await callGet()
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Failed to fetch API keys')
  })
})
