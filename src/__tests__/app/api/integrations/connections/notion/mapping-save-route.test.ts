import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * PUT /api/integrations/connections/notion/mapping
 *
 * - owner/adminのみ(requireOrgAdmin)
 * - connection_id は org_id・provider='notion' の境界付きで引く(他orgの接続は絶対に引けない)
 * - 不正なマッピング(型違い)は400
 * - ⚠ 信頼境界の本丸: クライアントが送ってきたmappingのprop_idが実在しなくても、
 *   サーバ側がライブスキーマを再取得して検証するため400で拒否される
 * - due_prop_idがdate型でなければ拒否
 * - 成功時: notion_mappings[database_id]保存 + read_container_idsに追加 + 他キー保持
 * - confirmed_atはクライアント指定値ではなくサーバ時刻になる
 */

const getUserMock = vi.fn()
const membershipSingleMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: getUserMock },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({ single: membershipSingleMock })),
        })),
      })),
    })),
  })),
}))

const connectionResultMock = vi.fn()
const updateResultMock = vi.fn()
let updatePayload: Record<string, unknown> | null = null

function makeSelectChain() {
  const chain: Record<string, unknown> = {}
  Object.assign(chain, {
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn(() => Promise.resolve(connectionResultMock())),
  })
  return chain
}

function makeUpdateChain() {
  const chain: Record<string, unknown> = {}
  Object.assign(chain, {
    eq: vi.fn(() => chain),
    select: vi.fn(() => ({
      maybeSingle: vi.fn(() => Promise.resolve(updateResultMock())),
    })),
  })
  return chain
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: vi.fn(() => ({
      select: vi.fn(() => makeSelectChain()),
      update: vi.fn((payload: Record<string, unknown>) => {
        updatePayload = payload
        return makeUpdateChain()
      }),
    })),
  }),
}))

const resolveCredentialsMock = vi.fn()
vi.mock('@/lib/task-sync/credentials', () => ({
  resolveCredentials: (...args: unknown[]) => resolveCredentialsMock(...args),
}))

const fetchDatabaseSchemaMock = vi.fn()
vi.mock('@/lib/task-sync/providers/notion/schema', async () => {
  const actual = await vi.importActual<typeof import('@/lib/task-sync/providers/notion/schema')>(
    '@/lib/task-sync/providers/notion/schema',
  )
  return {
    ...actual,
    fetchDatabaseSchema: (...args: unknown[]) => fetchDatabaseSchemaMock(...args),
  }
})

const { PUT } = await import('@/app/api/integrations/connections/notion/mapping/route')

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const CONNECTION_ID = '22222222-2222-4222-8222-222222222222'
const SPACE_ID = '33333333-3333-4333-8333-333333333333'
const DATABASE_ID = 'db-44444444'

function callPut(body: Record<string, unknown>) {
  const request = new NextRequest('http://localhost:3000/api/integrations/connections/notion/mapping', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return PUT(request)
}

const SCHEMA = [
  { id: 'title-1', name: 'Name', type: 'title' },
  { id: 'due-1', name: '期日', type: 'date' },
  { id: 'text-1', name: 'メモ', type: 'rich_text' },
  {
    id: 'status-1',
    name: 'ステータス',
    type: 'status',
    options: [
      { id: 'opt-todo', name: '未着手' },
      { id: 'opt-done', name: '完了' },
    ],
  },
]

const VALID_MAPPING = {
  due_prop_id: 'due-1',
  status: {
    prop_id: 'status-1',
    prop_type: 'status',
    done_option_ids: ['opt-done'],
    write_done_option_id: 'opt-done',
  },
  // クライアントが確認画面で表示用に持っているだけの値。サーバ時刻で必ず上書きされる想定。
  confirmed_at: '2020-01-01T00:00:00.000Z',
}

const VALID_BODY = {
  org_id: ORG_ID,
  connection_id: CONNECTION_ID,
  database_id: DATABASE_ID,
  mapping: VALID_MAPPING,
}

beforeEach(() => {
  vi.clearAllMocks()
  updatePayload = null
  getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
  membershipSingleMock.mockResolvedValue({ data: { role: 'owner' }, error: null })
  connectionResultMock.mockReturnValue({
    data: {
      id: CONNECTION_ID,
      org_id: ORG_ID,
      provider: 'notion',
      auth_kind: 'oauth',
      access_token_encrypted: 'enc',
      import_config: { target_space_id: SPACE_ID },
    },
    error: null,
  })
  resolveCredentialsMock.mockResolvedValue({ status: 'ok', credentials: { kind: 'oauth', token: 'secret-token' } })
  fetchDatabaseSchemaMock.mockResolvedValue(SCHEMA)
  updateResultMock.mockReturnValue({
    data: {
      id: CONNECTION_ID,
      import_config: {
        target_space_id: SPACE_ID,
        notion_mappings: { [DATABASE_ID]: { ...VALID_MAPPING, confirmed_at: 'server-time' } },
        read_container_ids: [DATABASE_ID],
      },
    },
    error: null,
  })
})

describe('PUT /api/integrations/connections/notion/mapping', () => {
  it('400 for a missing/invalid org_id', async () => {
    const response = await callPut({ ...VALID_BODY, org_id: 'not-a-uuid' })
    expect(response.status).toBe(400)
  })

  it('403 for members (owner/admin only)', async () => {
    membershipSingleMock.mockResolvedValue({ data: { role: 'member' }, error: null })
    const response = await callPut(VALID_BODY)
    expect(response.status).toBe(403)
  })

  it('404 when the connection does not belong to the requesting org', async () => {
    connectionResultMock.mockReturnValue({ data: null, error: null })
    const response = await callPut(VALID_BODY)
    expect(response.status).toBe(404)
  })

  it('400 when mapping has a type mismatch (status.prop_type invalid)', async () => {
    const response = await callPut({
      ...VALID_BODY,
      mapping: { ...VALID_MAPPING, status: { ...VALID_MAPPING.status, prop_type: 'not-a-real-type' } },
    })
    const data = await response.json()
    expect(response.status).toBe(400)
    expect(typeof data.error).toBe('string')
  })

  it('400 when mapping is missing entirely', async () => {
    const response = await callPut({ org_id: ORG_ID, connection_id: CONNECTION_ID, database_id: DATABASE_ID })
    expect(response.status).toBe(400)
  })

  /**
   * ⚠ 信頼境界の本丸: クライアントが何を送ろうと、存在しないprop_idはサーバ側の
   * ライブスキーマ再取得によって拒否される。
   */
  it('存在しないprop_idを送ると、クライアントが何を送ろうと400で拒否される(ライブスキーマ再取得で弾く)', async () => {
    const response = await callPut({
      ...VALID_BODY,
      mapping: { ...VALID_MAPPING, due_prop_id: 'ghost-prop-that-does-not-exist' },
    })
    const data = await response.json()
    expect(response.status).toBe(400)
    expect(typeof data.error).toBe('string')
    expect(data.error.length).toBeGreaterThan(0)
    // 保存は実行されない
    expect(updatePayload).toBeNull()
  })

  it('due_propがdate型でない場合に拒否される', async () => {
    const response = await callPut({
      ...VALID_BODY,
      mapping: { ...VALID_MAPPING, due_prop_id: 'text-1' },
    })
    expect(response.status).toBe(400)
    expect(updatePayload).toBeNull()
  })

  it('存在しないstatus option idを送ると400で拒否される', async () => {
    const response = await callPut({
      ...VALID_BODY,
      mapping: {
        ...VALID_MAPPING,
        status: { ...VALID_MAPPING.status, done_option_ids: ['ghost-option'], write_done_option_id: 'ghost-option' },
      },
    })
    expect(response.status).toBe(400)
    expect(updatePayload).toBeNull()
  })

  it('成功時にnotion_mappings[database_id]を保存し、read_container_idsにdatabase_idを追加し、既存のimport_configの他キーを保持する', async () => {
    const response = await callPut(VALID_BODY)
    expect(response.status).toBe(200)
    expect(updatePayload).not.toBeNull()
    const config = updatePayload!.import_config as Record<string, unknown>
    expect(config.target_space_id).toBe(SPACE_ID) // 他キーが保持される
    expect((config.notion_mappings as Record<string, unknown>)[DATABASE_ID]).toBeTruthy()
    expect(config.read_container_ids).toEqual([DATABASE_ID])
  })

  it('read_container_idsに既にdatabase_idが含まれる場合は重複させない', async () => {
    connectionResultMock.mockReturnValue({
      data: {
        id: CONNECTION_ID,
        org_id: ORG_ID,
        provider: 'notion',
        auth_kind: 'oauth',
        access_token_encrypted: 'enc',
        import_config: { target_space_id: SPACE_ID, read_container_ids: [DATABASE_ID] },
      },
      error: null,
    })
    await callPut(VALID_BODY)
    const config = updatePayload!.import_config as Record<string, unknown>
    expect(config.read_container_ids).toEqual([DATABASE_ID])
  })

  it('confirmed_atはクライアント指定値ではなくサーバ時刻になる', async () => {
    await callPut(VALID_BODY)
    const config = updatePayload!.import_config as Record<string, unknown>
    const saved = (config.notion_mappings as Record<string, { confirmed_at: string }>)[DATABASE_ID]
    expect(saved.confirmed_at).not.toBe(VALID_MAPPING.confirmed_at)
    // ISO8601形式のサーバ時刻であること
    expect(saved.confirmed_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })

  it('保存後のレスポンスは database_id と mapping のみ(秘密は含まない)', async () => {
    const response = await callPut(VALID_BODY)
    const data = await response.json()
    expect(data.database_id).toBe(DATABASE_ID)
    expect(data.mapping.due_prop_id).toBe('due-1')
    expect(JSON.stringify(data)).not.toContain('secret-token')
  })
})
