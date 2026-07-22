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
 * - 成功時: RPC(rpc_notion_mapping_merge)を正しい引数(接続id・org id・database id・mapping)で
 *   呼ぶ(全体置換ではなく該当DB分のマッピングだけを渡す。他DBのnotion_mappingsは一切含めない)
 * - confirmed_atはクライアント指定値ではなくサーバ時刻になる
 * - database_id は Notion のID形式(32桁hex or ハイフン付きUUID)以外は400
 * - JSONとして正当な`null`ボディでも500ではなく400
 * - ボディサイズには上限があり、超えると413
 * - Notionから401(トークン失効)が返れば409+再接続導線(403=アクセス権無しの400とは区別する)
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
const rpcResultMock = vi.fn()
/** findNotionConnection が積んだ .eq() 呼び出しの引数を全て記録する(境界の直接検証に使う)。 */
let connectionEqCalls: Array<[string, unknown]> = []
let rpcCallArgs: { name: string; params: Record<string, unknown> } | null = null

function makeSelectChain() {
  const chain: Record<string, unknown> = {}
  Object.assign(chain, {
    eq: vi.fn((...args: [string, unknown]) => {
      connectionEqCalls.push(args)
      return chain
    }),
    maybeSingle: vi.fn(() => Promise.resolve(connectionResultMock())),
  })
  return chain
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: vi.fn(() => ({
      select: vi.fn(() => makeSelectChain()),
    })),
    rpc: vi.fn((name: string, params: Record<string, unknown>) => {
      rpcCallArgs = { name, params }
      return Promise.resolve(rpcResultMock())
    }),
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
// Notion のデータベースIDはハイフン付きUUID表記(databases.retrieve のレスポンス相当)。
const DATABASE_ID = '44444444-4444-4444-8444-444444444444'

function callPutRaw(rawBody: string, headers: Record<string, string> = { 'Content-Type': 'application/json' }) {
  const request = new NextRequest('http://localhost:3000/api/integrations/connections/notion/mapping', {
    method: 'PUT',
    headers,
    body: rawBody,
  })
  return PUT(request)
}

function callPut(body: Record<string, unknown>) {
  return callPutRaw(JSON.stringify(body))
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
  connectionEqCalls = []
  rpcCallArgs = null
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
  rpcResultMock.mockReturnValue({
    data: {
      target_space_id: SPACE_ID,
      notion_mappings: { [DATABASE_ID]: { ...VALID_MAPPING, confirmed_at: 'server-time' } },
      read_container_ids: [DATABASE_ID],
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
    // 保存(RPC呼び出し)は実行されない
    expect(rpcCallArgs).toBeNull()
  })

  it('due_propがdate型でない場合に拒否される', async () => {
    const response = await callPut({
      ...VALID_BODY,
      mapping: { ...VALID_MAPPING, due_prop_id: 'text-1' },
    })
    expect(response.status).toBe(400)
    expect(rpcCallArgs).toBeNull()
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
    expect(rpcCallArgs).toBeNull()
  })

  it('成功時にRPC(rpc_notion_mapping_merge)を接続id・org id・database id・mappingで呼ぶ', async () => {
    const response = await callPut(VALID_BODY)
    expect(response.status).toBe(200)
    expect(rpcCallArgs).not.toBeNull()
    expect(rpcCallArgs!.name).toBe('rpc_notion_mapping_merge')
    expect(rpcCallArgs!.params.p_connection_id).toBe(CONNECTION_ID)
    expect(rpcCallArgs!.params.p_org_id).toBe(ORG_ID)
    expect(rpcCallArgs!.params.p_database_id).toBe(DATABASE_ID)
    expect((rpcCallArgs!.params.p_mapping as Record<string, unknown>).due_prop_id).toBe('due-1')
  })

  /**
   * ⚠ 回帰テスト(全体置換の再発防止): RPCに渡すのは「このdatabase_id分のmappingだけ」であり、
   * import_config全体や他DBのnotion_mappingsエントリを一切含めない(それらはRPC内のjsonb演算で
   * 保持される。詳細はmigration参照)。呼び出し側が丸ごと置換するオブジェクトを組み立てていないこと
   * をここで固定する。
   */
  it('RPC呼び出しはこのdatabase_id分のmappingのみを渡し、import_config全体や他キーを組み立てない', async () => {
    await callPut(VALID_BODY)
    const params = rpcCallArgs!.params
    expect(Object.keys(params).sort()).toEqual(['p_connection_id', 'p_database_id', 'p_mapping', 'p_org_id'])
    const serializedMapping = JSON.stringify(params.p_mapping)
    // import_configの他キー(target_space_id等)や他DBのnotion_mappingsを一切含まない。
    expect(serializedMapping).not.toContain('target_space_id')
    expect(serializedMapping).not.toContain('notion_mappings')
    expect(serializedMapping).not.toContain('read_container_ids')
  })

  it('confirmed_atはクライアント指定値ではなくサーバ時刻になる', async () => {
    await callPut(VALID_BODY)
    const mapping = rpcCallArgs!.params.p_mapping as { confirmed_at: string }
    expect(mapping.confirmed_at).not.toBe(VALID_MAPPING.confirmed_at)
    // ISO8601形式のサーバ時刻であること
    expect(mapping.confirmed_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })

  it('保存後のレスポンスは database_id と mapping のみ(秘密は含まない)', async () => {
    const response = await callPut(VALID_BODY)
    const data = await response.json()
    expect(data.database_id).toBe(DATABASE_ID)
    expect(data.mapping.due_prop_id).toBe('due-1')
    expect(JSON.stringify(data)).not.toContain('secret-token')
  })

  it('RPCがエラーを返したら500になる(内部文言は返さない)', async () => {
    rpcResultMock.mockReturnValue({ data: null, error: { message: 'connection does not belong to the specified org' } })
    const response = await callPut(VALID_BODY)
    const data = await response.json()
    expect(response.status).toBe(500)
    expect(data.error).not.toContain('connection does not belong to the specified org')
  })

  /**
   * ⚠ IDORテストが空振りしないための直接検証(認可境界)。findNotionConnectionが
   * .eq('id', ...) / .eq('org_id', ...) / .eq('provider', 'notion') の3条件で絞っていることを、
   * モックの.eq()呼び出し引数を記録して直接assertする(常に同じchainを返すだけのモックだと、
   * 実装から.eqを消してもテストが通ってしまい、境界を証明したことにならない)。
   */
  it('findNotionConnectionはid・org_id・provider=notionの3条件で.eq()を呼ぶ(認可境界の直接検証)', async () => {
    await callPut(VALID_BODY)
    const calledKeys = connectionEqCalls.map(([key]) => key)
    expect(calledKeys).toContain('id')
    expect(calledKeys).toContain('org_id')
    expect(calledKeys).toContain('provider')
    expect(connectionEqCalls).toContainEqual(['id', CONNECTION_ID])
    expect(connectionEqCalls).toContainEqual(['org_id', ORG_ID])
    expect(connectionEqCalls).toContainEqual(['provider', 'notion'])
  })

  describe('database_id の形式検証', () => {
    it('Notionのデータベースid形式(32桁hex/ハイフン付きUUID)以外は400', async () => {
      const response = await callPut({ ...VALID_BODY, database_id: 'db-not-a-real-id' })
      expect(response.status).toBe(400)
      expect(rpcCallArgs).toBeNull()
    })

    it('ハイフン無し32桁hexは受理する', async () => {
      const hexId = 'a'.repeat(32)
      const response = await callPut({ ...VALID_BODY, database_id: hexId })
      expect(response.status).toBe(200)
      expect(rpcCallArgs!.params.p_database_id).toBe(hexId)
    })
  })

  describe('JSONボディの検証', () => {
    it('正当なJSONの`null`リテラルボディは500ではなく400', async () => {
      const response = await callPutRaw('null')
      expect(response.status).toBe(400)
    })

    it('壊れたJSONは400', async () => {
      const response = await callPutRaw('{not json')
      expect(response.status).toBe(400)
    })

    it('配列ボディも400(objectではないため)', async () => {
      const response = await callPutRaw('[]')
      expect(response.status).toBe(400)
    })
  })

  describe('ボディサイズの上限', () => {
    it('Content-Lengthが上限超過なら読む前に413', async () => {
      const response = await callPutRaw('{}', {
        'Content-Type': 'application/json',
        'content-length': String(8 * 1024 + 1),
      })
      expect(response.status).toBe(413)
      expect(fetchDatabaseSchemaMock).not.toHaveBeenCalled()
    })

    it('Content-Lengthを付けない送信でも実サイズで413', async () => {
      const huge = JSON.stringify({ ...VALID_BODY, padding: 'あ'.repeat(8 * 1024) })
      const response = await callPutRaw(huge)
      expect(response.status).toBe(413)
    })
  })

  describe('Notion 401(トークン失効) vs 403(アクセス権無し)', () => {
    it('401なら409+再接続導線になる(失効トークン。403とは区別する)', async () => {
      fetchDatabaseSchemaMock.mockRejectedValue(Object.assign(new Error('unauthorized'), { status: 401 }))
      const response = await callPut(VALID_BODY)
      const data = await response.json()
      expect(response.status).toBe(409)
      expect(data.error).toContain('再接続')
    })

    it('403ならアクセス権無しの400のまま(トークンは有効)', async () => {
      fetchDatabaseSchemaMock.mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 }))
      const response = await callPut(VALID_BODY)
      expect(response.status).toBe(400)
    })
  })
})
