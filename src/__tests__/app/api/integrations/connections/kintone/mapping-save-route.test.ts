import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * PUT /api/integrations/connections/kintone/mapping
 *
 * - owner/adminのみ(requireOrgAdmin)
 * - connection_id は org_id・provider='kintone' の境界付きで引く(他orgの接続は絶対に引けない)
 * - 不正なマッピング(型違い)は400
 * - ⚠ 信頼境界の本丸: クライアントが送ってきたmappingのfield_codeが実在しなくても、
 *   サーバ側がライブのフィールド定義を再取得して検証するため400で拒否される
 * - due_field_codeがDATE型でなければ拒否
 * - STATUS以外でwrite_done_actionを指定したら拒否される
 * - 成功時: RPC(rpc_kintone_mapping_merge)を正しい引数(接続id・org id・app id・mapping)で
 *   呼ぶ(全体置換ではなく該当アプリ分のマッピングだけを渡す。他アプリのkintone_mappingsは一切含めない)
 * - confirmed_atはクライアント指定値ではなくサーバ時刻になる
 * - app_id はkintoneのアプリID形式(数値)以外は400
 * - JSONとして正当な`null`ボディでも500ではなく400
 * - ボディサイズには上限があり、超えると413
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
/** findKintoneConnection が積んだ .eq() 呼び出しの引数を全て記録する(境界の直接検証に使う)。 */
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

const { PUT } = await import('@/app/api/integrations/connections/kintone/mapping/route')

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const CONNECTION_ID = '22222222-2222-4222-8222-222222222222'
const APP_ID = '5'

function callPutRaw(rawBody: string, headers: Record<string, string> = { 'Content-Type': 'application/json' }) {
  const request = new NextRequest('http://localhost:3000/api/integrations/connections/kintone/mapping', {
    method: 'PUT',
    headers,
    body: rawBody,
  })
  return PUT(request)
}

function callPut(body: Record<string, unknown>) {
  return callPutRaw(JSON.stringify(body))
}

const FIELDS = [
  { code: 'title', label: '件名', type: 'SINGLE_LINE_TEXT' },
  { code: 'due', label: '期日', type: 'DATE' },
  { code: 'memo', label: 'メモ', type: 'MULTI_LINE_TEXT' },
  { code: 'select_status', label: '進捗', type: 'DROP_DOWN', options: ['未着手', '完了'] },
  { code: 'workflow', label: 'プロセス', type: 'STATUS' },
]

const VALID_MAPPING = {
  title_field_code: 'title',
  due_field_code: 'due',
  status: {
    field_code: 'select_status',
    field_type: 'DROP_DOWN',
    done_values: ['完了'],
    write_done_action: null,
  },
  // クライアントが確認画面で表示用に持っているだけの値。サーバ時刻で必ず上書きされる想定。
  confirmed_at: '2020-01-01T00:00:00.000Z',
}

const VALID_BODY = {
  org_id: ORG_ID,
  connection_id: CONNECTION_ID,
  app_id: APP_ID,
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
  rpcResultMock.mockReturnValue({
    data: {
      kintone_app_ids: [APP_ID],
      kintone_mappings: { [APP_ID]: { ...VALID_MAPPING, confirmed_at: 'server-time' } },
    },
    error: null,
  })
})

describe('PUT /api/integrations/connections/kintone/mapping', () => {
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

  it('400 when mapping has a type mismatch (status.field_type invalid)', async () => {
    const response = await callPut({
      ...VALID_BODY,
      mapping: { ...VALID_MAPPING, status: { ...VALID_MAPPING.status, field_type: 'not-a-real-type' } },
    })
    const data = await response.json()
    expect(response.status).toBe(400)
    expect(typeof data.error).toBe('string')
  })

  it('400 when mapping is missing entirely', async () => {
    const response = await callPut({ org_id: ORG_ID, connection_id: CONNECTION_ID, app_id: APP_ID })
    expect(response.status).toBe(400)
  })

  it('400 when title_field_code is missing (kintoneではtitleも必須)', async () => {
    const mappingWithoutTitle: Record<string, unknown> = { ...VALID_MAPPING }
    delete mappingWithoutTitle.title_field_code
    const response = await callPut({ ...VALID_BODY, mapping: mappingWithoutTitle })
    expect(response.status).toBe(400)
  })

  /**
   * ⚠ 信頼境界の本丸: クライアントが何を送ろうと、存在しないfield_codeはサーバ側の
   * ライブスキーマ再取得によって拒否される。
   */
  it('存在しないfield_codeを送ると、クライアントが何を送ろうと400で拒否される(ライブスキーマ再取得で弾く)', async () => {
    const response = await callPut({
      ...VALID_BODY,
      mapping: { ...VALID_MAPPING, due_field_code: 'ghost-field-that-does-not-exist' },
    })
    const data = await response.json()
    expect(response.status).toBe(400)
    expect(typeof data.error).toBe('string')
    expect(data.error.length).toBeGreaterThan(0)
    // 保存(RPC呼び出し)は実行されない
    expect(rpcCallArgs).toBeNull()
  })

  it('due_field_codeがDATE型でない場合に拒否される', async () => {
    const response = await callPut({
      ...VALID_BODY,
      mapping: { ...VALID_MAPPING, due_field_code: 'memo' },
    })
    expect(response.status).toBe(400)
    expect(rpcCallArgs).toBeNull()
  })

  it('存在しない選択肢名を送ると400で拒否される', async () => {
    const response = await callPut({
      ...VALID_BODY,
      mapping: {
        ...VALID_MAPPING,
        status: { ...VALID_MAPPING.status, done_values: ['ghost-option'] },
      },
    })
    expect(response.status).toBe(400)
    expect(rpcCallArgs).toBeNull()
  })

  /** ⚠ STATUS以外でwrite_done_actionを指定したら拒否される(mapping.tsのparse段階で拒否)。 */
  it('STATUS以外でwrite_done_actionを指定したら拒否される', async () => {
    const response = await callPut({
      ...VALID_BODY,
      mapping: { ...VALID_MAPPING, status: { ...VALID_MAPPING.status, write_done_action: 'アクション名' } },
    })
    const data = await response.json()
    expect(response.status).toBe(400)
    expect(data.error).toContain('STATUS')
    expect(rpcCallArgs).toBeNull()
  })

  it('STATUS型ならwrite_done_actionを指定できる', async () => {
    const response = await callPut({
      ...VALID_BODY,
      mapping: {
        ...VALID_MAPPING,
        status: { field_code: 'workflow', field_type: 'STATUS', done_values: ['完了'], write_done_action: '完了にする' },
      },
    })
    expect(response.status).toBe(200)
  })

  it('成功時にRPC(rpc_kintone_mapping_merge)を接続id・org id・app id・mappingで呼ぶ', async () => {
    const response = await callPut(VALID_BODY)
    expect(response.status).toBe(200)
    expect(rpcCallArgs).not.toBeNull()
    expect(rpcCallArgs!.name).toBe('rpc_kintone_mapping_merge')
    expect(rpcCallArgs!.params.p_connection_id).toBe(CONNECTION_ID)
    expect(rpcCallArgs!.params.p_org_id).toBe(ORG_ID)
    expect(rpcCallArgs!.params.p_app_id).toBe(APP_ID)
    expect((rpcCallArgs!.params.p_mapping as Record<string, unknown>).title_field_code).toBe('title')
  })

  /**
   * ⚠ 回帰テスト(全体置換の再発防止): RPCに渡すのは「このapp_id分のmappingだけ」であり、
   * import_config全体や他アプリのkintone_mappingsエントリを一切含めない(それらはRPC内のjsonb演算で
   * 保持される。詳細はmigration参照)。呼び出し側が丸ごと置換するオブジェクトを組み立てていないこと
   * をここで固定する。
   */
  it('RPC呼び出しはこのapp_id分のmappingのみを渡し、import_config全体や他キーを組み立てない', async () => {
    await callPut(VALID_BODY)
    const params = rpcCallArgs!.params
    expect(Object.keys(params).sort()).toEqual(['p_app_id', 'p_connection_id', 'p_mapping', 'p_org_id'])
    const serializedMapping = JSON.stringify(params.p_mapping)
    // import_configの他キー(kintone_app_ids等)や他アプリのkintone_mappingsを一切含まない。
    expect(serializedMapping).not.toContain('kintone_app_ids')
    expect(serializedMapping).not.toContain('kintone_mappings')
  })

  it('confirmed_atはクライアント指定値ではなくサーバ時刻になる', async () => {
    await callPut(VALID_BODY)
    const mapping = rpcCallArgs!.params.p_mapping as { confirmed_at: string }
    expect(mapping.confirmed_at).not.toBe(VALID_MAPPING.confirmed_at)
    // ISO8601形式のサーバ時刻であること
    expect(mapping.confirmed_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })

  it('保存後のレスポンスは app_id と mapping のみ(秘密は含まない)', async () => {
    const response = await callPut(VALID_BODY)
    const data = await response.json()
    expect(data.app_id).toBe(APP_ID)
    expect(data.mapping.title_field_code).toBe('title')
    expect(JSON.stringify(data)).not.toContain('secret-token')
  })

  it('RPCがエラーを返したら500になる(内部文言は返さない)', async () => {
    rpcResultMock.mockReturnValue({ data: null, error: { message: 'connection does not belong to the specified org' } })
    const response = await callPut(VALID_BODY)
    const data = await response.json()
    expect(response.status).toBe(500)
    expect(data.error).not.toContain('connection does not belong to the specified org')
  })

  // 既存 import_config の型が壊れている場合、RPC は 22023 を付けて明示的に失敗する
  // （黙って配列状の値を作って200を返す＝無言の失敗を防ぐため）。再試行しても直らない
  // 状態なので、5xx（あとで再試行せよ）ではなく 422 で「作り直せ」と伝える必要がある。
  it('既存設定の型が壊れている(22023)なら、再試行を促す5xxではなく422になる', async () => {
    rpcResultMock.mockReturnValue({
      data: null,
      error: { code: '22023', message: 'import_config.kintone_mappings is not a JSON object (found null)' },
    })
    const response = await callPut(VALID_BODY)
    const data = await response.json()
    expect(response.status).toBe(422)
    expect(data.error).not.toContain('kintone_mappings is not a JSON object')
  })

  /**
   * ⚠ TOCTOU: 事前チェック(kintone_app_idsにapp_idがあるか)は kintone への外部API呼び出しの
   * **前**に行うため、その間に接続編集でアプリが外されると古くなる。RPCは行ロック後に最新値で
   * 再確認し、外れていれば errcode='KTAPP' で拒否する。これは「設定が壊れている(22023)」とは
   * 別物で、利用者の次の行動も違う（先にアプリIDとAPIトークンを登録すれば解決する）ため、
   * 422 ではなく事前チェックと同じ 400・同じ文言に写像する。
   */
  it('保存直前にアプリが登録から外れた(KTAPP)なら、事前チェックと同じ400・同じ文言になる', async () => {
    rpcResultMock.mockReturnValue({
      data: null,
      error: { code: 'KTAPP', message: 'app_id 5 is not registered in import_config.kintone_app_ids' },
    })
    const response = await callPut(VALID_BODY)
    const data = await response.json()
    expect(response.status).toBe(400)
    expect(data.error).toBe('このアプリは接続に登録されていません。先にアプリIDとAPIトークンを追加してください')
    expect(data.error).not.toContain('kintone_app_ids')
  })

  /**
   * ⚠ IDORテストが空振りしないための直接検証(認可境界)。findKintoneConnectionが
   * .eq('id', ...) / .eq('org_id', ...) / .eq('provider', 'kintone') の3条件で絞っていることを、
   * モックの.eq()呼び出し引数を記録して直接assertする(常に同じchainを返すだけのモックだと、
   * 実装から.eqを消してもテストが通ってしまい、境界を証明したことにならない)。
   */
  it('findKintoneConnectionはid・org_id・provider=kintoneの3条件で.eq()を呼ぶ(認可境界の直接検証)', async () => {
    await callPut(VALID_BODY)
    const calledKeys = connectionEqCalls.map(([key]) => key)
    expect(calledKeys).toContain('id')
    expect(calledKeys).toContain('org_id')
    expect(calledKeys).toContain('provider')
    expect(connectionEqCalls).toContainEqual(['id', CONNECTION_ID])
    expect(connectionEqCalls).toContainEqual(['org_id', ORG_ID])
    expect(connectionEqCalls).toContainEqual(['provider', 'kintone'])
  })

  describe('app_id の形式検証', () => {
    it('数値以外のapp_idは400', async () => {
      const response = await callPut({ ...VALID_BODY, app_id: 'not-a-number' })
      expect(response.status).toBe(400)
      expect(rpcCallArgs).toBeNull()
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
      const response = await callPut({ ...VALID_BODY, app_id: '42' })
      expect(response.status).toBe(200)
      expect(rpcCallArgs!.params.p_app_id).toBe('42')
    })
  })

  /**
   * ⚠ 「死んだマッピング」の防止(fable裁定): kintone_app_ids に登録されていない app_id は、
   * RPC呼び出しの**前**に400で拒否する(保存できるのに永久に取り込まれない「死んだマッピング」を
   * 作らせないため)。
   */
  describe('kintone_app_ids に未登録の app_id', () => {
    it('kintone_app_idsに無いapp_idは400になり、RPCが呼ばれない', async () => {
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
      const response = await callPut(VALID_BODY)
      const data = await response.json()
      expect(response.status).toBe(400)
      expect(typeof data.error).toBe('string')
      expect(rpcCallArgs).toBeNull()
      expect(fetchAppFieldsMock).not.toHaveBeenCalled()
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
      const response = await callPut(VALID_BODY)
      expect(response.status).toBe(400)
      expect(rpcCallArgs).toBeNull()
    })

    it('登録済みのapp_idなら従来どおり通る(回帰)', async () => {
      // beforeEachの既定値(kintone_app_ids: [APP_ID])のまま。
      const response = await callPut(VALID_BODY)
      expect(response.status).toBe(200)
      expect(rpcCallArgs).not.toBeNull()
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
      expect(fetchAppFieldsMock).not.toHaveBeenCalled()
    })

    it('Content-Lengthを付けない送信でも実サイズで413', async () => {
      const huge = JSON.stringify({ ...VALID_BODY, padding: 'あ'.repeat(8 * 1024) })
      const response = await callPutRaw(huge)
      expect(response.status).toBe(413)
    })
  })

  describe('kintone 401/403(アクセス権無し) の扱い', () => {
    it('恒久失敗(permanent)は具体的な理由付きで400になる', async () => {
      fetchAppFieldsMock.mockRejectedValue(
        Object.assign(new Error('kintone: このAPIトークンは指定されたアプリのものではありません'), {
          status: 403,
          permanent: true,
        }),
      )
      const response = await callPut(VALID_BODY)
      const data = await response.json()
      expect(response.status).toBe(400)
      expect(data.error).toContain('アプリのものではありません')
      expect(rpcCallArgs).toBeNull()
    })

    it('404(アプリが見つからない)はそのまま404', async () => {
      fetchAppFieldsMock.mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }))
      const response = await callPut(VALID_BODY)
      expect(response.status).toBe(404)
    })
  })
})
