import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST /api/integrations/connections/notion/mapping/propose
 *
 * - owner/adminのみ(requireOrgAdmin)
 * - connection_id は org_id・provider='notion' の境界付きで引く(他orgの接続は絶対に引けない)
 * - AIによる精緻化は「プロパティのメタデータのみ」をLLMに渡す(レコード値・トークンは一切渡さない)
 * - AI呼び出し失敗(AiConfigError・LLM障害・出力不正)はヒューリスティックへフォールバックし200で返す
 * - 返す直前に必ずライブスキーマへ再突き合わせし、無効な部分はnullに落とす
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
/** findNotionConnection が積んだ .eq() 呼び出しの引数を全て記録する(境界の直接検証に使う)。 */
let connectionEqCalls: Array<[string, unknown]> = []
function makeConnectionSelectChain() {
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
    from: vi.fn(() => ({ select: vi.fn(() => makeConnectionSelectChain()) })),
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

const callLlmMock = vi.fn()
vi.mock('@/lib/ai/client', () => ({
  callLlm: (...args: unknown[]) => callLlmMock(...args),
}))

const { POST } = await import('@/app/api/integrations/connections/notion/mapping/propose/route')
const { AiConfigError } = await import('@/lib/ai/errors')

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const CONNECTION_ID = '22222222-2222-4222-8222-222222222222'
// Notion のデータベースIDはハイフン付きUUID表記(databases.retrieve のレスポンス相当)。
const DATABASE_ID = '33333333-3333-4333-8333-333333333333'

function callPostRaw(rawBody: string, headers: Record<string, string> = { 'Content-Type': 'application/json' }) {
  const request = new NextRequest('http://localhost:3000/api/integrations/connections/notion/mapping/propose', {
    method: 'POST',
    headers,
    body: rawBody,
  })
  return POST(request)
}

function callPost(body: Record<string, unknown>) {
  return callPostRaw(JSON.stringify(body))
}

const VALID_BODY = { org_id: ORG_ID, connection_id: CONNECTION_ID, database_id: DATABASE_ID }

const SCHEMA = [
  { id: 'title-1', name: 'Name', type: 'title' },
  { id: 'due-1', name: '期日', type: 'date' },
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

beforeEach(() => {
  vi.clearAllMocks()
  connectionEqCalls = []
  getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
  membershipSingleMock.mockResolvedValue({ data: { role: 'owner' }, error: null })
  connectionResultMock.mockReturnValue({
    data: { id: CONNECTION_ID, org_id: ORG_ID, provider: 'notion', auth_kind: 'oauth', access_token_encrypted: 'enc' },
    error: null,
  })
  resolveCredentialsMock.mockResolvedValue({ status: 'ok', credentials: { kind: 'oauth', token: 'secret-token' } })
  fetchDatabaseSchemaMock.mockResolvedValue(SCHEMA)
  callLlmMock.mockResolvedValue({
    content: JSON.stringify({ due_prop_id: 'due-1', status_prop_id: 'status-1', done_option_ids: ['opt-done'] }),
  })
})

describe('POST /api/integrations/connections/notion/mapping/propose', () => {
  it('400 for a missing/invalid org_id', async () => {
    const response = await callPost({ ...VALID_BODY, org_id: 'not-a-uuid' })
    expect(response.status).toBe(400)
  })

  it('403 for members (owner/admin only)', async () => {
    membershipSingleMock.mockResolvedValue({ data: { role: 'member' }, error: null })
    const response = await callPost(VALID_BODY)
    expect(response.status).toBe(403)
  })

  it('401 when unauthenticated', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })
    const response = await callPost(VALID_BODY)
    expect(response.status).toBe(401)
  })

  it('404 when the connection does not belong to the requesting org (cross-org access is impossible)', async () => {
    // 他orgの接続を指定 -> DB問い合わせは org_id で絞っているため見つからない
    connectionResultMock.mockReturnValue({ data: null, error: null })
    const response = await callPost(VALID_BODY)
    expect(response.status).toBe(404)
  })

  it('404 when the connection exists but provider is not notion', async () => {
    // provider!=='notion' の接続は findNotionConnection の .eq('provider','notion') で弾かれ、
    // maybeSingle は null を返す(このモックではDB問い合わせの絞り込み自体をシミュレートしないため、
    // クエリが provider を条件に積んでいることは実装コードのeq呼び出しで担保している。
    // 下の「.eq()の引数を直接検証する」テストが、この境界が実際に存在することを固定する)
    connectionResultMock.mockReturnValue({ data: null, error: null })
    const response = await callPost(VALID_BODY)
    expect(response.status).toBe(404)
  })

  /**
   * ⚠ IDORテストが空振りしないための直接検証(認可境界)。上の2つの404テストはモックが
   * 常に同じ結果を返すため、実装から `.eq('org_id', ...)` や `.eq('provider','notion')` を
   * 消してもテスト自体は通ってしまう(空振り)。ここでは .eq() 呼び出しの実引数を記録して、
   * id・org_id・provider の3条件で絞っていることを直接assertする。
   */
  it('findNotionConnectionはid・org_id・provider=notionの3条件で.eq()を呼ぶ(認可境界の直接検証)', async () => {
    await callPost(VALID_BODY)
    const calledKeys = connectionEqCalls.map(([key]) => key)
    expect(calledKeys).toContain('id')
    expect(calledKeys).toContain('org_id')
    expect(calledKeys).toContain('provider')
    expect(connectionEqCalls).toContainEqual(['id', CONNECTION_ID])
    expect(connectionEqCalls).toContainEqual(['org_id', ORG_ID])
    expect(connectionEqCalls).toContainEqual(['provider', 'notion'])
  })

  it('422 when credentials are misconfigured', async () => {
    resolveCredentialsMock.mockResolvedValue({ status: 'misconfigured', reason: 'oauth access token is missing' })
    const response = await callPost(VALID_BODY)
    expect(response.status).toBe(422)
  })

  it('409 when credentials are auth_failed (needs reconnect)', async () => {
    resolveCredentialsMock.mockResolvedValue({ status: 'auth_failed' })
    const response = await callPost(VALID_BODY)
    expect(response.status).toBe(409)
  })

  /**
   * ⚠ 不変条件の回帰テスト: callLlm に渡す messages にレコード値・トークンが含まれないこと。
   */
  it('LLMに渡すメッセージにレコード値・トークン・org特定情報を一切含めない', async () => {
    await callPost(VALID_BODY)

    expect(callLlmMock).toHaveBeenCalledTimes(1)
    const callArgs = callLlmMock.mock.calls[0][0] as { orgId: string; messages: unknown; purpose?: string }
    expect(callArgs.orgId).toBe(ORG_ID)
    expect(callArgs.purpose).toBe('notion_mapping_propose')

    const serialized = JSON.stringify(callArgs.messages)
    expect(serialized).not.toContain('secret-token')
    expect(serialized).not.toContain(CONNECTION_ID)
    expect(serialized).not.toContain(DATABASE_ID)
    expect(serialized).not.toContain(ORG_ID)
    // メタデータ(プロパティ名)は含まれてよい
    expect(serialized).toContain('期日')
  })

  it('LLMが実在しないprop_idを返したら採用せず、ヒューリスティック/nullに落ちる', async () => {
    callLlmMock.mockResolvedValue({
      content: JSON.stringify({ due_prop_id: 'ghost-prop-id', status_prop_id: null, done_option_ids: [] }),
    })
    const response = await callPost(VALID_BODY)
    const data = await response.json()
    expect(response.status).toBe(200)
    // ghost-prop-id は採用されない。ヒューリスティックのdue-1(唯一のdate型)にフォールバックする
    expect(data.proposal.due_prop_id).toBe('due-1')
  })

  it('AiConfigError(AI未設定・上限到達)でも200でヒューリスティック提案が返る(proposal_source:heuristic)', async () => {
    callLlmMock.mockRejectedValue(new AiConfigError('missing', 'AI未設定'))
    const response = await callPost(VALID_BODY)
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.proposal_source).toBe('heuristic')
    expect(data.proposal.due_prop_id).toBe('due-1')
  })

  it('AiConfigError(pool_quota_exhausted)でも200でヒューリスティック提案が返る', async () => {
    callLlmMock.mockRejectedValue(new AiConfigError('pool_quota_exhausted', '上限到達'))
    const response = await callPost(VALID_BODY)
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.proposal_source).toBe('heuristic')
  })

  it('LLMが壊れたJSONを返しても200でフォールバックする', async () => {
    callLlmMock.mockResolvedValue({ content: 'not json at all {' })
    const response = await callPost(VALID_BODY)
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.proposal_source).toBe('heuristic')
    expect(data.proposal.due_prop_id).toBe('due-1')
  })

  it('正常系: schema/proposal/proposal_sourceを返し、confirmed_atは含めない', async () => {
    const response = await callPost(VALID_BODY)
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.schema).toEqual(SCHEMA)
    expect(data.proposal_source).toBe('ai')
    expect(data.proposal.confirmed_at).toBeUndefined()
    expect(data.proposal).toEqual({
      due_prop_id: 'due-1',
      status: {
        prop_id: 'status-1',
        prop_type: 'status',
        done_option_ids: ['opt-done'],
        write_done_option_id: 'opt-done',
      },
    })
  })

  it('404 when fetchDatabaseSchema fails with 404 (database not found)', async () => {
    fetchDatabaseSchemaMock.mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }))
    const response = await callPost(VALID_BODY)
    expect(response.status).toBe(404)
  })

  // 401(トークン失効)と403(DBが共有されていない)は原因も対処も違う。同じ「アクセス権が
  // ありません」に畳むと、再接続すべき場面で利用者がNotion側の共有をやり直そうとして
  // 解決しない。保存API・resolveCredentials の auth_failed と同じ導線に揃える。
  it('401(トークン失効)なら409+再接続導線になる', async () => {
    fetchDatabaseSchemaMock.mockRejectedValue(Object.assign(new Error('unauthorized'), { status: 401 }))
    const response = await callPost(VALID_BODY)
    expect(response.status).toBe(409)
    expect((await response.json()).error).toContain('再接続')
  })

  it('403(DBが共有されていない)はアクセス権無しの400のまま', async () => {
    fetchDatabaseSchemaMock.mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 }))
    const response = await callPost(VALID_BODY)
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('アクセス権')
  })

  describe('database_id の形式検証', () => {
    it('Notionのデータベースid形式(32桁hex/ハイフン付きUUID)以外は400', async () => {
      const response = await callPost({ ...VALID_BODY, database_id: 'db-not-a-real-id' })
      expect(response.status).toBe(400)
    })

    it('ハイフン無し32桁hexは受理する', async () => {
      const hexId = 'a'.repeat(32)
      const response = await callPost({ ...VALID_BODY, database_id: hexId })
      expect(response.status).toBe(200)
      expect(fetchDatabaseSchemaMock).toHaveBeenCalledWith('secret-token', hexId)
    })
  })

  describe('JSONボディの検証', () => {
    it('正当なJSONの`null`リテラルボディは500ではなく400', async () => {
      const response = await callPostRaw('null')
      expect(response.status).toBe(400)
    })

    it('壊れたJSONは400', async () => {
      const response = await callPostRaw('{not json')
      expect(response.status).toBe(400)
    })

    it('配列ボディも400(objectではないため)', async () => {
      const response = await callPostRaw('[]')
      expect(response.status).toBe(400)
    })
  })

  describe('ボディサイズの上限', () => {
    it('Content-Lengthが上限超過なら読む前に413', async () => {
      const response = await callPostRaw('{}', {
        'Content-Type': 'application/json',
        'content-length': String(8 * 1024 + 1),
      })
      expect(response.status).toBe(413)
      expect(fetchDatabaseSchemaMock).not.toHaveBeenCalled()
    })

    it('Content-Lengthを付けない送信でも実サイズで413', async () => {
      const huge = JSON.stringify({ ...VALID_BODY, padding: 'あ'.repeat(8 * 1024) })
      const response = await callPostRaw(huge)
      expect(response.status).toBe(413)
    })
  })
})
