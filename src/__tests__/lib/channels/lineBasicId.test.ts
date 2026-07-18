import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * LINE友だち追加QR導線: channel_accounts.line_basic_id の取得＋遅延バックフィル。
 *
 * identity(本人特定)は一切変更しない — basic_id は「Botを見つけて友だち追加する」までの
 * 純粋加算UX（QR）の材料に過ぎない。本人特定は従来どおりコード返信方式のみが正。
 *
 * - org専用bot(owner_type='org') を優先し、無ければ共有bot(owner_type='platform')。
 * - 既に line_basic_id があれば LINE API を叩かずそれを返す。
 * - 無ければ credentials を復号して access_token を取り出し、fetchBotInfo で basicId を
 *   取得 → channel_accounts.line_basic_id を UPDATE してから返す（ベストエフォート）。
 * - credentials(access_token)自体は呼び出し元へ絶対に返さない（返るのは basicId 文字列のみ）。
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chain(response: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {}
  for (const m of ['select', 'eq', 'update', 'limit']) {
    builder[m] = vi.fn(() => builder)
  }
  builder.single = vi.fn(() => Promise.resolve(response))
  builder.maybeSingle = vi.fn(() => Promise.resolve(response))
  builder.then = (resolve: (value: unknown) => void) => resolve(response)
  return builder
}

let fromResponses: Record<string, unknown>
let fromCallCount: number
const fromMock = vi.fn()
const rpcMock = vi.fn()
const fetchBotInfoMock = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ from: fromMock, rpc: rpcMock })),
}))

vi.mock('@/lib/channels/line/client', () => ({
  fetchBotInfo: fetchBotInfoMock,
}))

const store = await import('@/lib/channels/store')

const ORG_ROW = {
  id: 'acc-org-1',
  org_id: 'org-1',
  display_name: '山田会計事務所',
  credentials_encrypted: 'enc-blob',
  status: 'active',
  owner_type: 'org',
  line_basic_id: null as string | null,
}

const PLATFORM_ROW = {
  id: 'acc-platform-1',
  org_id: null,
  display_name: 'agentpm秘書',
  credentials_encrypted: 'enc-blob',
  status: 'active',
  owner_type: 'platform',
  line_basic_id: null as string | null,
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.SYSTEM_ENCRYPTION_KEY = 'test-encryption-key'
  fromResponses = {}
  fromCallCount = 0
  fromMock.mockImplementation((table: string) => {
    fromCallCount += 1
    const key = `${table}#${fromCallCount}`
    const response = fromResponses[key] ?? fromResponses[table] ?? { data: null, error: null }
    return chain(response)
  })
  rpcMock.mockImplementation((fn: string) =>
    Promise.resolve(
      fn === 'decrypt_system_secret'
        ? { data: JSON.stringify({ channel_secret: 'secret', access_token: 'token-abc' }), error: null }
        : { data: null, error: null },
    ),
  )
})

describe('getLineBasicIdForOrg', () => {
  it('org専用botに既に line_basic_id があれば LINE API を叩かずそれを返す', async () => {
    fromResponses['channel_accounts#1'] = { data: { ...ORG_ROW, line_basic_id: '@already' }, error: null }

    const result = await store.getLineBasicIdForOrg('org-1')

    expect(result).toBe('@already')
    expect(fetchBotInfoMock).not.toHaveBeenCalled()
    // 取得のみ(1回)。UPDATEは呼ばれない
    expect(fromMock).toHaveBeenCalledTimes(1)
  })

  it('org専用botが無く共有botのみのとき、共有botを見る', async () => {
    fromResponses['channel_accounts#1'] = { data: null, error: null } // org lookup: 無し
    fromResponses['channel_accounts#2'] = { data: { ...PLATFORM_ROW, line_basic_id: '@shared' }, error: null }

    const result = await store.getLineBasicIdForOrg('org-1')

    expect(result).toBe('@shared')
    expect(fetchBotInfoMock).not.toHaveBeenCalled()
  })

  it('line_basic_id が無ければ復号→fetchBotInfoで取得しUPDATEしてから返す', async () => {
    fromResponses['channel_accounts#1'] = { data: ORG_ROW, error: null } // line_basic_id: null
    fromResponses['channel_accounts#2'] = { data: null, error: null } // update response
    fetchBotInfoMock.mockResolvedValue({ basicId: '@fetched' })

    const result = await store.getLineBasicIdForOrg('org-1')

    expect(result).toBe('@fetched')
    // 復号: credentials_encrypted を decrypt_system_secret に渡す
    expect(rpcMock).toHaveBeenCalledWith('decrypt_system_secret', {
      encrypted: 'enc-blob',
      secret: 'test-encryption-key',
    })
    // access_token を fetchBotInfo に渡す（credentials自体は返さない）
    expect(fetchBotInfoMock).toHaveBeenCalledWith('token-abc')
    // UPDATEが呼ばれている
    expect(fromMock).toHaveBeenCalledTimes(2)
    const updateBuilder = fromMock.mock.results[1].value
    expect(updateBuilder.update).toHaveBeenCalledWith({ line_basic_id: '@fetched' })
    expect(updateBuilder.eq).toHaveBeenCalledWith('id', 'acc-org-1')
  })

  it('org/platform いずれのbotも無ければ null（LINE APIは叩かない）', async () => {
    fromResponses['channel_accounts#1'] = { data: null, error: null }
    fromResponses['channel_accounts#2'] = { data: null, error: null }

    const result = await store.getLineBasicIdForOrg('org-1')

    expect(result).toBeNull()
    expect(fetchBotInfoMock).not.toHaveBeenCalled()
  })

  it('fetchBotInfoがnullを返す(ベストエフォート失敗)場合は null で、UPDATEもしない', async () => {
    fromResponses['channel_accounts#1'] = { data: ORG_ROW, error: null }
    fetchBotInfoMock.mockResolvedValue(null)

    const result = await store.getLineBasicIdForOrg('org-1')

    expect(result).toBeNull()
    // UPDATEは呼ばれていない（channel_accountsへは取得の1回のみ）
    expect(fromMock).toHaveBeenCalledTimes(1)
  })

  it('credentialsの復号に失敗すれば null（例外は投げない）', async () => {
    fromResponses['channel_accounts#1'] = { data: ORG_ROW, error: null }
    rpcMock.mockResolvedValue({ data: null, error: { message: 'decrypt failed' } })

    const result = await store.getLineBasicIdForOrg('org-1')

    expect(result).toBeNull()
    expect(fetchBotInfoMock).not.toHaveBeenCalled()
  })

  it('戻り値はbasicId文字列のみ（access_token等の機微を含むオブジェクトを返さない）', async () => {
    fromResponses['channel_accounts#1'] = { data: { ...ORG_ROW, line_basic_id: '@already' }, error: null }

    const result = await store.getLineBasicIdForOrg('org-1')

    expect(typeof result).toBe('string')
  })
})

describe('getLineBasicIdWithOwnerTypeForOrg（文言分岐用の拡張版）', () => {
  it('org専用botなら ownerType: "org" を添えて返す', async () => {
    fromResponses['channel_accounts#1'] = { data: { ...ORG_ROW, line_basic_id: '@already' }, error: null }

    const result = await store.getLineBasicIdWithOwnerTypeForOrg('org-1')

    expect(result).toEqual({ basicId: '@already', ownerType: 'org' })
  })

  it('共有botのみのとき ownerType: "platform" を添えて返す', async () => {
    fromResponses['channel_accounts#1'] = { data: null, error: null }
    fromResponses['channel_accounts#2'] = { data: { ...PLATFORM_ROW, line_basic_id: '@shared' }, error: null }

    const result = await store.getLineBasicIdWithOwnerTypeForOrg('org-1')

    expect(result).toEqual({ basicId: '@shared', ownerType: 'platform' })
  })

  it('accountが無ければ null', async () => {
    fromResponses['channel_accounts#1'] = { data: null, error: null }
    fromResponses['channel_accounts#2'] = { data: null, error: null }

    const result = await store.getLineBasicIdWithOwnerTypeForOrg('org-1')

    expect(result).toBeNull()
  })

  it('basicIdが取得できなければ（fetchBotInfo失敗）null（ownerTypeだけ返すことはしない）', async () => {
    fromResponses['channel_accounts#1'] = { data: ORG_ROW, error: null }
    fetchBotInfoMock.mockResolvedValue(null)

    const result = await store.getLineBasicIdWithOwnerTypeForOrg('org-1')

    expect(result).toBeNull()
  })
})
