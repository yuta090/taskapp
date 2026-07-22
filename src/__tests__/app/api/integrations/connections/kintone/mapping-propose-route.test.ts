import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST /api/integrations/connections/kintone/mapping/propose
 *
 * - owner/adminのみ(requireOrgAdmin)
 * - connection_id は org_id・provider='kintone' の境界付きで引く(他orgの接続は絶対に引けない)
 * - AIによる精緻化は「フィールドのメタデータのみ」をLLMに渡す(レコード値・トークンは一切渡さない)
 * - AI呼び出し失敗(AiConfigError・LLM障害・出力不正)はヒューリスティックへフォールバックし200で返す
 * - 返す直前に必ずライブスキーマへ再突き合わせし、無効な部分はnullに落とす
 * - STATUS以外のフィールドにwrite_done_actionを提案しない(常にnull)
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
/** findKintoneConnection が積んだ .eq() 呼び出しの引数を全て記録する(境界の直接検証に使う)。 */
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

const fetchAppFieldsMock = vi.fn()
vi.mock('@/lib/task-sync/providers/kintone/schema', async () => {
  const actual = await vi.importActual<typeof import('@/lib/task-sync/providers/kintone/schema')>(
    '@/lib/task-sync/providers/kintone/schema',
  )
  return {
    ...actual,
    fetchAppFields: (...args: unknown[]) => fetchAppFieldsMock(...args),
  }
})

const callLlmMock = vi.fn()
vi.mock('@/lib/ai/client', () => ({
  callLlm: (...args: unknown[]) => callLlmMock(...args),
}))

const { POST } = await import('@/app/api/integrations/connections/kintone/mapping/propose/route')
const { AiConfigError } = await import('@/lib/ai/errors')

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const CONNECTION_ID = '22222222-2222-4222-8222-222222222222'
const APP_ID = '5'

function callPostRaw(rawBody: string, headers: Record<string, string> = { 'Content-Type': 'application/json' }) {
  const request = new NextRequest('http://localhost:3000/api/integrations/connections/kintone/mapping/propose', {
    method: 'POST',
    headers,
    body: rawBody,
  })
  return POST(request)
}

function callPost(body: Record<string, unknown>) {
  return callPostRaw(JSON.stringify(body))
}

const VALID_BODY = { org_id: ORG_ID, connection_id: CONNECTION_ID, app_id: APP_ID }

const FIELDS = [
  { code: 'title', label: '件名', type: 'SINGLE_LINE_TEXT' },
  { code: 'due', label: '期日', type: 'DATE' },
  { code: 'select_status', label: '進捗', type: 'DROP_DOWN', options: ['未着手', '完了'] },
]

beforeEach(() => {
  vi.clearAllMocks()
  connectionEqCalls = []
  getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
  membershipSingleMock.mockResolvedValue({ data: { role: 'owner' }, error: null })
  connectionResultMock.mockReturnValue({
    data: {
      id: CONNECTION_ID,
      org_id: ORG_ID,
      provider: 'kintone',
      auth_kind: 'api_key',
      base_url: 'https://example.cybozu.com',
      access_token_encrypted: 'enc',
      import_config: { kintone_app_ids: [APP_ID] },
    },
    error: null,
  })
  resolveCredentialsMock.mockResolvedValue({
    status: 'ok',
    credentials: { kind: 'api_key', token: 'secret-token', baseUrl: 'https://example.cybozu.com' },
  })
  fetchAppFieldsMock.mockResolvedValue(FIELDS)
  callLlmMock.mockResolvedValue({
    content: JSON.stringify({
      title_field_code: 'title',
      due_field_code: 'due',
      status_field_code: 'select_status',
      done_values: ['完了'],
    }),
  })
})

describe('POST /api/integrations/connections/kintone/mapping/propose', () => {
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
    connectionResultMock.mockReturnValue({ data: null, error: null })
    const response = await callPost(VALID_BODY)
    expect(response.status).toBe(404)
  })

  it('404 when the connection exists but provider is not kintone', async () => {
    connectionResultMock.mockReturnValue({ data: null, error: null })
    const response = await callPost(VALID_BODY)
    expect(response.status).toBe(404)
  })

  /**
   * ⚠ IDORテストが空振りしないための直接検証(認可境界)。上の2つの404テストはモックが
   * 常に同じ結果を返すため、実装から `.eq('org_id', ...)` や `.eq('provider','kintone')` を
   * 消してもテスト自体は通ってしまう(空振り)。ここでは .eq() 呼び出しの実引数を記録して、
   * id・org_id・provider の3条件で絞っていることを直接assertする。
   */
  it('findKintoneConnectionはid・org_id・provider=kintoneの3条件で.eq()を呼ぶ(認可境界の直接検証)', async () => {
    await callPost(VALID_BODY)
    const calledKeys = connectionEqCalls.map(([key]) => key)
    expect(calledKeys).toContain('id')
    expect(calledKeys).toContain('org_id')
    expect(calledKeys).toContain('provider')
    expect(connectionEqCalls).toContainEqual(['id', CONNECTION_ID])
    expect(connectionEqCalls).toContainEqual(['org_id', ORG_ID])
    expect(connectionEqCalls).toContainEqual(['provider', 'kintone'])
  })

  it('422 when credentials are misconfigured', async () => {
    resolveCredentialsMock.mockResolvedValue({ status: 'misconfigured', reason: 'api_key is missing' })
    const response = await callPost(VALID_BODY)
    expect(response.status).toBe(422)
  })

  it('409 when credentials are auth_failed (needs reconnect)', async () => {
    resolveCredentialsMock.mockResolvedValue({ status: 'auth_failed' })
    const response = await callPost(VALID_BODY)
    expect(response.status).toBe(409)
  })

  /**
   * ⚠ 不変条件の回帰テスト: callLlm に渡す messages にレコード値・トークン・org特定情報が
   * 含まれないこと。
   */
  it('LLMに渡すメッセージにレコード値・トークン・org特定情報を一切含めない', async () => {
    await callPost(VALID_BODY)

    expect(callLlmMock).toHaveBeenCalledTimes(1)
    const callArgs = callLlmMock.mock.calls[0][0] as { orgId: string; messages: unknown; purpose?: string }
    expect(callArgs.orgId).toBe(ORG_ID)
    expect(callArgs.purpose).toBe('kintone_mapping_propose')

    const serialized = JSON.stringify(callArgs.messages)
    expect(serialized).not.toContain('secret-token')
    expect(serialized).not.toContain(CONNECTION_ID)
    expect(serialized).not.toContain(APP_ID)
    expect(serialized).not.toContain(ORG_ID)
    // メタデータ(フィールド名)は含まれてよい
    expect(serialized).toContain('期日')
  })

  it('LLMが実在しないfield_codeを返したら採用せず、ヒューリスティック/nullに落ちる', async () => {
    callLlmMock.mockResolvedValue({
      content: JSON.stringify({
        title_field_code: 'ghost-field',
        due_field_code: null,
        status_field_code: null,
        done_values: [],
      }),
    })
    const response = await callPost(VALID_BODY)
    const data = await response.json()
    expect(response.status).toBe(200)
    // ghost-field は採用されない。ヒューリスティックのtitle(唯一のSINGLE_LINE_TEXT型)にフォールバックする
    expect(data.proposal.title_field_code).toBe('title')
  })

  it('AiConfigError(AI未設定・上限到達)でも200でヒューリスティック提案が返る(proposal_source:heuristic)', async () => {
    callLlmMock.mockRejectedValue(new AiConfigError('missing', 'AI未設定'))
    const response = await callPost(VALID_BODY)
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.proposal_source).toBe('heuristic')
    expect(data.proposal.title_field_code).toBe('title')
    expect(data.proposal.due_field_code).toBe('due')
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
    expect(data.proposal.due_field_code).toBe('due')
  })

  it('正常系: schema/proposal/proposal_sourceを返し、confirmed_atは含めない', async () => {
    const response = await callPost(VALID_BODY)
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.schema).toEqual(FIELDS)
    expect(data.proposal_source).toBe('ai')
    expect(data.proposal.confirmed_at).toBeUndefined()
    expect(data.proposal).toEqual({
      title_field_code: 'title',
      due_field_code: 'due',
      status: {
        field_code: 'select_status',
        field_type: 'DROP_DOWN',
        done_values: ['完了'],
        write_done_action: null,
      },
    })
  })

  /** ⚠ STATUS以外のフィールドにwrite_done_actionを提案しないこと(この提案APIは常にnullを返す)。 */
  it('STATUS以外のフィールドにwrite_done_actionを提案しない(常にnull)', async () => {
    const response = await callPost(VALID_BODY)
    const data = await response.json()
    expect(data.proposal.status.field_type).not.toBe('STATUS')
    expect(data.proposal.status.write_done_action).toBeNull()
  })

  it('STATUS型フィールドを検出した場合もwrite_done_actionを提案しない(常にnull)', async () => {
    fetchAppFieldsMock.mockResolvedValue([
      { code: 'title', label: '件名', type: 'SINGLE_LINE_TEXT' },
      { code: 'workflow', label: 'プロセス', type: 'STATUS' },
    ])
    callLlmMock.mockResolvedValue({
      content: JSON.stringify({
        title_field_code: 'title',
        due_field_code: null,
        status_field_code: 'workflow',
        done_values: ['完了'],
      }),
    })
    const response = await callPost(VALID_BODY)
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.proposal.status.field_type).toBe('STATUS')
    expect(data.proposal.status.write_done_action).toBeNull()
    // STATUS型のdone_valuesは検証できないため常に空配列に倒す(mappingWizard.tsの設計)。
    expect(data.proposal.status.done_values).toEqual([])
  })

  it('404 when fetchAppFields fails with 404 (app not found)', async () => {
    fetchAppFieldsMock.mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }))
    const response = await callPost(VALID_BODY)
    expect(response.status).toBe(404)
  })

  it('恒久失敗(permanent)は具体的な理由付きで400になる', async () => {
    fetchAppFieldsMock.mockRejectedValue(
      Object.assign(
        new Error('kintone: APIトークンの設定がこのアプリの運用環境に反映されていません。「アプリを更新」ボタンを押してください'),
        { status: 403, permanent: true },
      ),
    )
    const response = await callPost(VALID_BODY)
    const data = await response.json()
    expect(response.status).toBe(400)
    expect(data.error).toContain('アプリを更新')
  })

  it('一時障害は502になる', async () => {
    fetchAppFieldsMock.mockRejectedValue(Object.assign(new Error('network blip'), { status: 503 }))
    const response = await callPost(VALID_BODY)
    expect(response.status).toBe(502)
  })

  describe('app_id の形式検証', () => {
    it('数値以外のapp_idは400', async () => {
      const response = await callPost({ ...VALID_BODY, app_id: 'not-a-number' })
      expect(response.status).toBe(400)
    })

    it('空文字のapp_idは400', async () => {
      const response = await callPost({ ...VALID_BODY, app_id: '' })
      expect(response.status).toBe(400)
    })

    it('数値文字列のapp_idは受理する', async () => {
      // kintone_app_ids に '42' 自体を登録済みにしないと、下の「未登録app_idは拒否」ゲートで
      // 400になってしまう(このテストは形式検証だけを見たいので、登録済み扱いにする)。
      connectionResultMock.mockReturnValue({
        data: {
          id: CONNECTION_ID,
          org_id: ORG_ID,
          provider: 'kintone',
          auth_kind: 'api_key',
          base_url: 'https://example.cybozu.com',
          access_token_encrypted: 'enc',
          import_config: { kintone_app_ids: ['42'] },
        },
        error: null,
      })
      const response = await callPost({ ...VALID_BODY, app_id: '42' })
      expect(response.status).toBe(200)
      expect(fetchAppFieldsMock).toHaveBeenCalledWith('https://example.cybozu.com', 'secret-token', '42')
    })
  })

  /**
   * ⚠ 「死んだマッピング」の防止(fable裁定): kintone_app_ids に登録されていない app_id は、
   * 外部API(fetchAppFields)・LLM(callLlm)呼び出しの**前**に400で拒否する
   * (未登録アプリに対して無駄な外部到達・AI課金を発生させないため)。
   */
  describe('kintone_app_ids に未登録の app_id', () => {
    it('kintone_app_idsに無いapp_idは400になり、外部API(fetchAppFields)もLLM(callLlm)も呼ばれない', async () => {
      connectionResultMock.mockReturnValue({
        data: {
          id: CONNECTION_ID,
          org_id: ORG_ID,
          provider: 'kintone',
          auth_kind: 'api_key',
          base_url: 'https://example.cybozu.com',
          access_token_encrypted: 'enc',
          import_config: { kintone_app_ids: ['999'] }, // APP_ID('5')を含まない
        },
        error: null,
      })
      const response = await callPost(VALID_BODY)
      const data = await response.json()
      expect(response.status).toBe(400)
      expect(typeof data.error).toBe('string')
      expect(fetchAppFieldsMock).not.toHaveBeenCalled()
      expect(callLlmMock).not.toHaveBeenCalled()
    })

    it('kintone_app_idsが空/未設定の接続でも同様に400になる', async () => {
      connectionResultMock.mockReturnValue({
        data: {
          id: CONNECTION_ID,
          org_id: ORG_ID,
          provider: 'kintone',
          auth_kind: 'api_key',
          base_url: 'https://example.cybozu.com',
          access_token_encrypted: 'enc',
          import_config: {},
        },
        error: null,
      })
      const response = await callPost(VALID_BODY)
      expect(response.status).toBe(400)
      expect(fetchAppFieldsMock).not.toHaveBeenCalled()
      expect(callLlmMock).not.toHaveBeenCalled()
    })

    it('登録済みのapp_idなら従来どおり通る(回帰)', async () => {
      // beforeEachの既定値(kintone_app_ids: [APP_ID])のまま。
      const response = await callPost(VALID_BODY)
      expect(response.status).toBe(200)
      expect(fetchAppFieldsMock).toHaveBeenCalled()
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
      expect(fetchAppFieldsMock).not.toHaveBeenCalled()
    })

    it('Content-Lengthを付けない送信でも実サイズで413', async () => {
      const huge = JSON.stringify({ ...VALID_BODY, padding: 'あ'.repeat(8 * 1024) })
      const response = await callPostRaw(huge)
      expect(response.status).toBe(413)
    })
  })
})
