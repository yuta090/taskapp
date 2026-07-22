import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST/DELETE /api/integrations/connections/kintone/apps — 接続後のアプリ追加・削除。
 *
 * 固定したい境界:
 *   - owner/adminのみ(requireOrgAdmin)
 *   - connection_id は org_id・provider='kintone' の境界付きで引く(他orgの接続は絶対に引けない)
 *   - 追加は疎通確認(fetchAppFields)を経てから保存する(外部呼び出し・RPCの順序)
 *   - 既に登録済みのapp_idの再追加は409(トークンの入れ替えは許さない。判断済み)
 *   - 9個上限は事前チェック(400・fetchAppFields呼び出し前)とRPC側のTOCTOU再確認(KT9MX)の両方
 *   - 最後の1アプリは削除できない(400・RPC呼び出し前)
 *   - 秘密(APIトークン・暗号鍵)は応答に含めない
 */

const requireOrgAdminMock = vi.fn()
vi.mock('@/lib/channels/authz', () => ({ requireOrgAdmin: (...a: unknown[]) => requireOrgAdminMock(...a) }))

const connectionResultMock = vi.fn()
const rpcResultMock = vi.fn()
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

const getEncryptionKeyMock = vi.fn()
vi.mock('@/lib/integrations/token-crypto', () => ({
  getEncryptionKey: (...a: unknown[]) => getEncryptionKeyMock(...a),
}))

const fetchAppFieldsMock = vi.fn()
vi.mock('@/lib/task-sync/providers/kintone/schema', async () => {
  const actual = await vi.importActual<typeof import('@/lib/task-sync/providers/kintone/schema')>(
    '@/lib/task-sync/providers/kintone/schema',
  )
  return { ...actual, fetchAppFields: (...a: unknown[]) => fetchAppFieldsMock(...a) }
})

const { POST, DELETE } = await import('@/app/api/integrations/connections/kintone/apps/route')

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const CONNECTION_ID = '22222222-2222-4222-8222-222222222222'

function callRaw(method: 'POST' | 'DELETE', rawBody: string, headers: Record<string, string> = { 'Content-Type': 'application/json' }) {
  const request = new NextRequest('http://localhost:3000/api/integrations/connections/kintone/apps', {
    method,
    headers,
    body: rawBody,
  })
  return method === 'POST' ? POST(request) : DELETE(request)
}

function callPost(body: Record<string, unknown>) {
  return callRaw('POST', JSON.stringify(body))
}

function callDelete(body: Record<string, unknown>) {
  return callRaw('DELETE', JSON.stringify(body))
}

const FIELDS = [{ code: 'title', label: '件名', type: 'SINGLE_LINE_TEXT' }]

function connectionWith(appIds: string[]) {
  return {
    id: CONNECTION_ID,
    org_id: ORG_ID,
    provider: 'kintone',
    base_url: 'https://example.cybozu.com',
    import_config: { kintone_app_ids: appIds },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  connectionEqCalls = []
  rpcCallArgs = null
  requireOrgAdminMock.mockResolvedValue({ ok: true })
  connectionResultMock.mockReturnValue({ data: connectionWith(['5']), error: null })
  fetchAppFieldsMock.mockResolvedValue(FIELDS)
  getEncryptionKeyMock.mockReturnValue('the-secret')
  rpcResultMock.mockReturnValue({ data: { app_ids: ['5', '9'] }, error: null })
})

describe('POST /api/integrations/connections/kintone/apps（アプリの追加）', () => {
  it('400: org_idが不正', async () => {
    const res = await callPost({ org_id: 'nope', connection_id: CONNECTION_ID, app_id: '9', api_token: 't' })
    expect(res.status).toBe(400)
  })

  it('400: connection_idが不正', async () => {
    const res = await callPost({ org_id: ORG_ID, connection_id: 'nope', app_id: '9', api_token: 't' })
    expect(res.status).toBe(400)
  })

  it('400: app_idが数値形式でない', async () => {
    const res = await callPost({ org_id: ORG_ID, connection_id: CONNECTION_ID, app_id: 'abc', api_token: 't' })
    expect(res.status).toBe(400)
  })

  it('400: api_tokenが空', async () => {
    const res = await callPost({ org_id: ORG_ID, connection_id: CONNECTION_ID, app_id: '9', api_token: '  ' })
    expect(res.status).toBe(400)
    expect(fetchAppFieldsMock).not.toHaveBeenCalled()
  })

  it('403: owner/admin以外は拒否される', async () => {
    requireOrgAdminMock.mockResolvedValue({ ok: false, error: 'Forbidden', status: 403 })
    const res = await callPost({ org_id: ORG_ID, connection_id: CONNECTION_ID, app_id: '9', api_token: 't' })
    expect(res.status).toBe(403)
  })

  it('404: 接続が見つからない(他orgの接続は絶対に引けない)', async () => {
    connectionResultMock.mockReturnValue({ data: null, error: null })
    const res = await callPost({ org_id: ORG_ID, connection_id: CONNECTION_ID, app_id: '9', api_token: 't' })
    expect(res.status).toBe(404)
  })

  it('findKintoneConnectionはid・org_id・provider=kintoneの3条件で.eq()を呼ぶ(認可境界)', async () => {
    await callPost({ org_id: ORG_ID, connection_id: CONNECTION_ID, app_id: '9', api_token: 't' })
    const keys = connectionEqCalls.map(([k]) => k)
    expect(keys).toContain('id')
    expect(keys).toContain('org_id')
    expect(keys).toContain('provider')
    expect(connectionEqCalls).toContainEqual(['provider', 'kintone'])
  })

  /**
   * ⚠ 判断(実装ランナーへの委任事項への回答): 既に登録済みのapp_idの再追加は409で拒否する
   * (トークンの入れ替えは許さない。ローテーションは削除→追加の2手順に委ねる)。
   * 事前チェック段階で弾くため、外部呼び出し(fetchAppFields)・RPC呼び出しは一切発生しない。
   */
  it('409: 既に登録済みのapp_idを追加しようとすると拒否され、疎通確認もRPCも呼ばれない', async () => {
    connectionResultMock.mockReturnValue({ data: connectionWith(['5', '9']), error: null })
    const res = await callPost({ org_id: ORG_ID, connection_id: CONNECTION_ID, app_id: '9', api_token: 't' })
    expect(res.status).toBe(409)
    expect(fetchAppFieldsMock).not.toHaveBeenCalled()
    expect(rpcCallArgs).toBeNull()
  })

  /**
   * ⚠ 9個上限: 事前チェック(400・疎通確認/RPC呼び出し前)とRPC側のTOCTOU再確認(KT9MX)の両方で守る。
   */
  it('400: 9個上限に達している接続への追加は事前チェックで拒否され、疎通確認は呼ばれない', async () => {
    connectionResultMock.mockReturnValue({
      data: connectionWith(['1', '2', '3', '4', '5', '6', '7', '8', '9']),
      error: null,
    })
    const res = await callPost({ org_id: ORG_ID, connection_id: CONNECTION_ID, app_id: '10', api_token: 't' })
    const data = await res.json()
    expect(res.status).toBe(400)
    expect(data.error).toContain('9')
    expect(fetchAppFieldsMock).not.toHaveBeenCalled()
    expect(rpcCallArgs).toBeNull()
  })

  it('400: RPCがKT9MXを返した場合も同じ400(TOCTOUで後から上限超過が判明した場合)', async () => {
    rpcResultMock.mockReturnValue({ data: null, error: { code: 'KT9MX', message: 'limit reached' } })
    const res = await callPost({ org_id: ORG_ID, connection_id: CONNECTION_ID, app_id: '9', api_token: 't' })
    const data = await res.json()
    expect(res.status).toBe(400)
    expect(data.error).not.toContain('limit reached')
  })

  it('409: RPCがKTDUPを返した場合も409(TOCTOUで後から重複が判明した場合)', async () => {
    rpcResultMock.mockReturnValue({ data: null, error: { code: 'KTDUP', message: 'already registered' } })
    const res = await callPost({ org_id: ORG_ID, connection_id: CONNECTION_ID, app_id: '9', api_token: 't' })
    expect(res.status).toBe(409)
  })

  it('422: RPCがKTGAP(トークン対応の欠落)を返したら再接続を促す文言で422', async () => {
    rpcResultMock.mockReturnValue({ data: null, error: { code: 'KTGAP', message: 'missing entry' } })
    const res = await callPost({ org_id: ORG_ID, connection_id: CONNECTION_ID, app_id: '9', api_token: 't' })
    const data = await res.json()
    expect(res.status).toBe(422)
    expect(data.error).toContain('作り直')
  })

  /** ⚠ 追加前に必ず疎通確認する(新しいトークンでfetchAppFieldsを叩く。失敗したら保存しない)。 */
  it('疎通確認(fetchAppFields)を新しいAPIトークンで実行し、失敗したらRPCを呼ばず保存しない', async () => {
    fetchAppFieldsMock.mockRejectedValue(
      Object.assign(new Error('kintone: このAPIトークンは指定されたアプリのものではありません'), {
        status: 403,
        permanent: true,
      }),
    )
    const res = await callPost({ org_id: ORG_ID, connection_id: CONNECTION_ID, app_id: '9', api_token: 'wrong-token' })
    const data = await res.json()
    expect(res.status).toBe(400)
    expect(data.error).toContain('アプリのものではありません')
    expect(rpcCallArgs).toBeNull()
    expect(fetchAppFieldsMock).toHaveBeenCalledWith('https://example.cybozu.com', 'wrong-token', '9')
  })

  it('404: fetchAppFieldsが404を返したらそのまま404', async () => {
    fetchAppFieldsMock.mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }))
    const res = await callPost({ org_id: ORG_ID, connection_id: CONNECTION_ID, app_id: '9', api_token: 't' })
    expect(res.status).toBe(404)
  })

  it('502: fetchAppFieldsの一時障害は502', async () => {
    fetchAppFieldsMock.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }))
    const res = await callPost({ org_id: ORG_ID, connection_id: CONNECTION_ID, app_id: '9', api_token: 't' })
    expect(res.status).toBe(502)
  })

  it('成功時: RPC(rpc_kintone_apps_add)を接続id・org id・app id・平文トークン・暗号鍵で呼ぶ', async () => {
    const res = await callPost({ org_id: ORG_ID, connection_id: CONNECTION_ID, app_id: '9', api_token: 'new-token' })
    expect(res.status).toBe(200)
    expect(rpcCallArgs!.name).toBe('rpc_kintone_apps_add')
    expect(rpcCallArgs!.params).toEqual({
      p_connection_id: CONNECTION_ID,
      p_org_id: ORG_ID,
      p_app_id: '9',
      p_new_token_plaintext: 'new-token',
      p_encryption_secret: 'the-secret',
    })
  })

  it('応答は app_ids のみで、平文トークン・暗号鍵を一切含まない', async () => {
    const res = await callPost({ org_id: ORG_ID, connection_id: CONNECTION_ID, app_id: '9', api_token: 'new-token' })
    const data = await res.json()
    expect(data).toEqual({ app_ids: ['5', '9'] })
    expect(JSON.stringify(data)).not.toContain('new-token')
    expect(JSON.stringify(data)).not.toContain('the-secret')
  })

  describe('JSONボディの検証', () => {
    it('nullリテラルボディは500ではなく400', async () => {
      const res = await callRaw('POST', 'null')
      expect(res.status).toBe(400)
    })

    it('壊れたJSONは400', async () => {
      const res = await callRaw('POST', '{not json')
      expect(res.status).toBe(400)
    })
  })

  describe('ボディサイズの上限', () => {
    it('Content-Lengthが上限超過なら読む前に413', async () => {
      const res = await callRaw('POST', '{}', {
        'Content-Type': 'application/json',
        'content-length': String(8 * 1024 + 1),
      })
      expect(res.status).toBe(413)
      expect(fetchAppFieldsMock).not.toHaveBeenCalled()
    })
  })
})

describe('DELETE /api/integrations/connections/kintone/apps（アプリの削除）', () => {
  it('403: owner/admin以外は拒否される', async () => {
    requireOrgAdminMock.mockResolvedValue({ ok: false, error: 'Forbidden', status: 403 })
    const res = await callDelete({ org_id: ORG_ID, connection_id: CONNECTION_ID, app_id: '5' })
    expect(res.status).toBe(403)
  })

  it('404: 接続が見つからない', async () => {
    connectionResultMock.mockReturnValue({ data: null, error: null })
    const res = await callDelete({ org_id: ORG_ID, connection_id: CONNECTION_ID, app_id: '5' })
    expect(res.status).toBe(404)
  })

  it('404: 登録されていないapp_idの削除は404(RPCは呼ばれない)', async () => {
    connectionResultMock.mockReturnValue({ data: connectionWith(['5', '9']), error: null })
    const res = await callDelete({ org_id: ORG_ID, connection_id: CONNECTION_ID, app_id: '999' })
    expect(res.status).toBe(404)
    expect(rpcCallArgs).toBeNull()
  })

  /**
   * ⚠ 不変条件: 接続は最低1アプリを持つ(task-sync/route.tsの作成時ゲートと同じ制約を、
   * 接続のライフサイクル全体で維持する)。事前チェックでRPC呼び出し前に拒否する。
   */
  it('400: 最後の1アプリは削除できない(事前チェックでRPCは呼ばれない)', async () => {
    connectionResultMock.mockReturnValue({ data: connectionWith(['5']), error: null })
    const res = await callDelete({ org_id: ORG_ID, connection_id: CONNECTION_ID, app_id: '5' })
    const data = await res.json()
    expect(res.status).toBe(400)
    expect(data.error).toContain('最後の1つ')
    expect(rpcCallArgs).toBeNull()
  })

  it('400: RPCがKTLASTを返した場合も同じ400(TOCTOUで後から判明した場合)', async () => {
    connectionResultMock.mockReturnValue({ data: connectionWith(['5', '9']), error: null })
    rpcResultMock.mockReturnValue({ data: null, error: { code: 'KTLAST', message: 'cannot remove last' } })
    const res = await callDelete({ org_id: ORG_ID, connection_id: CONNECTION_ID, app_id: '9' })
    expect(res.status).toBe(400)
  })

  it('422: RPCがKTGAPを返したら再接続を促す文言で422', async () => {
    connectionResultMock.mockReturnValue({ data: connectionWith(['5', '9']), error: null })
    rpcResultMock.mockReturnValue({ data: null, error: { code: 'KTGAP', message: 'missing entry' } })
    const res = await callDelete({ org_id: ORG_ID, connection_id: CONNECTION_ID, app_id: '9' })
    const data = await res.json()
    expect(res.status).toBe(422)
    expect(data.error).toContain('作り直')
  })

  it('成功時: RPC(rpc_kintone_apps_remove)を接続id・org id・app id・暗号鍵で呼ぶ(疎通確認は不要)', async () => {
    connectionResultMock.mockReturnValue({ data: connectionWith(['5', '9']), error: null })
    const res = await callDelete({ org_id: ORG_ID, connection_id: CONNECTION_ID, app_id: '9' })
    expect(res.status).toBe(200)
    expect(fetchAppFieldsMock).not.toHaveBeenCalled()
    expect(rpcCallArgs!.name).toBe('rpc_kintone_apps_remove')
    expect(rpcCallArgs!.params).toEqual({
      p_connection_id: CONNECTION_ID,
      p_org_id: ORG_ID,
      p_app_id: '9',
      p_encryption_secret: 'the-secret',
    })
  })

  it('応答は app_ids のみ(秘密を含まない)', async () => {
    connectionResultMock.mockReturnValue({ data: connectionWith(['5', '9']), error: null })
    const res = await callDelete({ org_id: ORG_ID, connection_id: CONNECTION_ID, app_id: '9' })
    const data = await res.json()
    expect(data).toEqual({ app_ids: ['5', '9'] })
  })
})
