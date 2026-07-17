import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * src/lib/integrations/token-manager.ts — OAuthトークンのrefresh/取得共通ロジック。
 *
 * レビュー指摘(PR-4 Google Sheets adapter)の回帰テスト:
 * 1) refresh成功のたびにrefresh_tokenがnullで上書きされるバグ(接続後約55分の初回refreshで
 *    google_sheets/google_calendar/google_meet全てのrefresh_tokenが失われ、次の期限切れ後に
 *    再認可必須のexpiredへ落ちる)。
 * 2) refreshの一時障害(5xx/ネットワーク/timeout)でconnectionがexpired化され、以後の配達が
 *    恒久失敗になるバグ。失効(400/401)と一時障害を分類し、一時障害ではDBを触らない。
 *
 * 既存のrefreshIfNeeded/getValidTokenのシグネチャ・null挙動は変えない
 * (呼び出し元: google-meet.ts, freebusy/route.ts, sinks/store.ts)。
 */

const fromMock = vi.fn()
const fromCalls: Array<{ table: string }> = []
const updateSpy = vi.fn()
const rpcMock = vi.fn()

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ from: fromMock, rpc: rpcMock })),
}))

const { refreshIfNeeded, getValidToken, getValidTokenDetailed } = await import(
  '@/lib/integrations/token-manager'
)

const CONNECTION_ID = 'conn-1'
const ACTIVE_CONNECTION = {
  id: CONNECTION_ID,
  provider: 'google_sheets',
  access_token: 'old-access-token',
  refresh_token: 'refresh-token-1',
  // 期限切れ(bufferの5分を過ぎている)
  token_expires_at: new Date(Date.now() - 60_000).toISOString(),
  status: 'active',
}

let selectResponse: unknown
let updateResponse: unknown

/**
 * 疑似暗号: encrypt_system_secret -> `enc(<平文>)`, decrypt_system_secret -> 中身を取り出す。
 * 実物は pgcrypto (pgp_sym_encrypt + base64) だが、ここで検証したいのは
 * 「暗号化列を読み書きしているか」「平文へフォールバックするか」であって暗号強度ではない。
 */
function fakeCryptoRpc(fn: string, args: Record<string, string>) {
  if (fn === 'encrypt_system_secret') {
    return Promise.resolve({ data: `enc(${args.plaintext})`, error: null })
  }
  if (fn === 'decrypt_system_secret') {
    const m = /^enc\((.*)\)$/.exec(args.encrypted ?? '')
    return m
      ? Promise.resolve({ data: m[1], error: null })
      : Promise.resolve({ data: null, error: { message: 'wrong key' } })
  }
  throw new Error(`unexpected rpc: ${fn}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  fromCalls.length = 0
  selectResponse = { data: ACTIVE_CONNECTION, error: null }
  updateResponse = { data: null, error: null }
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.example.com'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
  process.env.SYSTEM_ENCRYPTION_KEY = 'test-encryption-key'
  rpcMock.mockImplementation(fakeCryptoRpc)

  fromMock.mockImplementation((table: string) => {
    fromCalls.push({ table })
    return {
      // .select('*').eq('id', connectionId).single() -> selectResponse
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve(selectResponse)),
        })),
      })),
      // .update(data).eq('id', connectionId) は bare await（更新失敗の記録のみ）、
      // .update(data).eq('id', connectionId).select('*').single() はrefresh成功時の再取得
      update: vi.fn((data: Record<string, unknown>) => {
        updateSpy(data)
        return {
          eq: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn(() => Promise.resolve(updateResponse)),
            })),
            then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
              Promise.resolve({ error: null }).then(resolve, reject),
          })),
        }
      }),
    }
  })
})

function refreshFnError(status?: number): (refreshToken: string) => Promise<never> {
  return async () => {
    const error = new Error(status ? `token refresh failed (${status})` : 'network error') as Error & {
      status?: number
    }
    if (status !== undefined) error.status = status
    throw error
  }
}

describe('refreshIfNeeded / getValidToken (既存の契約を維持)', () => {
  it('有効期限内ならrefreshFnを呼ばずそのまま返す', async () => {
    selectResponse = {
      data: { ...ACTIVE_CONNECTION, token_expires_at: new Date(Date.now() + 3600_000).toISOString() },
      error: null,
    }
    const refreshFn = vi.fn()
    const connection = await refreshIfNeeded(CONNECTION_ID, refreshFn)
    expect(refreshFn).not.toHaveBeenCalled()
    expect(connection?.access_token).toBe('old-access-token')
  })

  it('token_expires_atが無ければ有効とみなす', async () => {
    selectResponse = { data: { ...ACTIVE_CONNECTION, token_expires_at: null }, error: null }
    const refreshFn = vi.fn()
    const connection = await refreshIfNeeded(CONNECTION_ID, refreshFn)
    expect(refreshFn).not.toHaveBeenCalled()
    expect(connection).not.toBeNull()
  })

  it('refresh_tokenが無ければexpired化してnullを返す', async () => {
    selectResponse = { data: { ...ACTIVE_CONNECTION, refresh_token: null }, error: null }
    const refreshFn = vi.fn()
    const connection = await refreshIfNeeded(CONNECTION_ID, refreshFn)
    expect(connection).toBeNull()
    expect(updateSpy).toHaveBeenCalledWith({ status: 'expired' })
  })

  it('refresh成功でaccess_token/token_expires_atを更新し、新しいconnectionを返す', async () => {
    updateResponse = {
      data: { ...ACTIVE_CONNECTION, access_token: 'new-access-token' },
      error: null,
    }
    const refreshFn = vi.fn().mockResolvedValue({
      accessToken: 'new-access-token',
      refreshToken: 'rotated-refresh-token',
      expiresAt: new Date(Date.now() + 3600_000),
    })
    const connection = await refreshIfNeeded(CONNECTION_ID, refreshFn)
    expect(connection?.access_token).toBe('new-access-token')

    const updateArg = updateSpy.mock.calls[0][0] as Record<string, unknown>
    expect(updateArg.refresh_token).toBe('rotated-refresh-token')
    expect(updateArg.status).toBe('active')
  })

  it('【回帰】refresh応答にrefresh_tokenが無い(null)場合、DBのrefresh_tokenを上書きしない', async () => {
    updateResponse = { data: { ...ACTIVE_CONNECTION, access_token: 'new-access-token' }, error: null }
    // GoogleのOAuth refresh grantはrefresh_tokenを通常返さない(refreshAccessTokenは
    // data.refresh_token ?? null で null を返す実装)
    const refreshFn = vi.fn().mockResolvedValue({
      accessToken: 'new-access-token',
      refreshToken: null,
      expiresAt: new Date(Date.now() + 3600_000),
    })
    await refreshIfNeeded(CONNECTION_ID, refreshFn)

    const updateArg = updateSpy.mock.calls[0][0] as Record<string, unknown>
    expect(updateArg).not.toHaveProperty('refresh_token')
  })

  it('refreshFnがstatus=401で失敗したらexpired化してnullを返す(失効)', async () => {
    const connection = await refreshIfNeeded(CONNECTION_ID, refreshFnError(401))
    expect(connection).toBeNull()
    expect(updateSpy).toHaveBeenCalledWith({ status: 'expired' })
  })

  it('refreshFnがstatus=400で失敗したらexpired化してnullを返す(失効)', async () => {
    const connection = await refreshIfNeeded(CONNECTION_ID, refreshFnError(400))
    expect(connection).toBeNull()
    expect(updateSpy).toHaveBeenCalledWith({ status: 'expired' })
  })

  it('【回帰】refreshFnがstatus=500で失敗してもexpired化せずnullを返す(一時障害)', async () => {
    const connection = await refreshIfNeeded(CONNECTION_ID, refreshFnError(500))
    expect(connection).toBeNull()
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('【回帰】refreshFnがstatus無し(ネットワークエラー)で失敗してもexpired化せずnullを返す', async () => {
    const connection = await refreshIfNeeded(CONNECTION_ID, refreshFnError())
    expect(connection).toBeNull()
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('getValidTokenはrefreshIfNeededの結果からaccess_tokenだけを返す', async () => {
    selectResponse = {
      data: { ...ACTIVE_CONNECTION, token_expires_at: new Date(Date.now() + 3600_000).toISOString() },
      error: null,
    }
    const token = await getValidToken(CONNECTION_ID, vi.fn())
    expect(token).toBe('old-access-token')
  })

  it('getValidTokenは失敗時にnullを返す(500でも400でも同じnull契約)', async () => {
    expect(await getValidToken(CONNECTION_ID, refreshFnError(500))).toBeNull()
  })
})

describe('getValidTokenDetailed (Google Sheets store.ts専用の詳細版)', () => {
  it('有効期限内なら{status:"ok", token}を返す', async () => {
    selectResponse = {
      data: { ...ACTIVE_CONNECTION, token_expires_at: new Date(Date.now() + 3600_000).toISOString() },
      error: null,
    }
    const result = await getValidTokenDetailed(CONNECTION_ID, vi.fn())
    expect(result).toEqual({ status: 'ok', token: 'old-access-token' })
  })

  it('refresh成功で{status:"ok", token}を返す', async () => {
    updateResponse = { data: { ...ACTIVE_CONNECTION, access_token: 'new-access-token' }, error: null }
    const refreshFn = vi.fn().mockResolvedValue({
      accessToken: 'new-access-token',
      refreshToken: 'rotated',
      expiresAt: new Date(Date.now() + 3600_000),
    })
    const result = await getValidTokenDetailed(CONNECTION_ID, refreshFn)
    expect(result).toEqual({ status: 'ok', token: 'new-access-token' })
  })

  it('refresh_tokenが無ければ{status:"auth_failed"}(expired化する)', async () => {
    selectResponse = { data: { ...ACTIVE_CONNECTION, refresh_token: null }, error: null }
    const result = await getValidTokenDetailed(CONNECTION_ID, vi.fn())
    expect(result).toEqual({ status: 'auth_failed' })
    expect(updateSpy).toHaveBeenCalledWith({ status: 'expired' })
  })

  it('refreshFnが401で失敗したら{status:"auth_failed"}(expired化する)', async () => {
    const result = await getValidTokenDetailed(CONNECTION_ID, refreshFnError(401))
    expect(result).toEqual({ status: 'auth_failed' })
    expect(updateSpy).toHaveBeenCalledWith({ status: 'expired' })
  })

  it('refreshFnが400で失敗したら{status:"auth_failed"}(expired化する)', async () => {
    const result = await getValidTokenDetailed(CONNECTION_ID, refreshFnError(400))
    expect(result).toEqual({ status: 'auth_failed' })
  })

  it('refreshFnが500で失敗したら{status:"transient_error"}でDBを触らない', async () => {
    const result = await getValidTokenDetailed(CONNECTION_ID, refreshFnError(500))
    expect(result).toEqual({ status: 'transient_error' })
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('refreshFnがネットワークエラー(status無し)で失敗したら{status:"transient_error"}でDBを触らない', async () => {
    const result = await getValidTokenDetailed(CONNECTION_ID, refreshFnError())
    expect(result).toEqual({ status: 'transient_error' })
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('DB読み取り自体が失敗したら{status:"transient_error"}を返す(接続行のレース、DBは触らない)', async () => {
    selectResponse = { data: null, error: { message: 'timeout' } }
    const result = await getValidTokenDetailed(CONNECTION_ID, vi.fn())
    expect(result).toEqual({ status: 'transient_error' })
  })
})

/**
 * トークン暗号化 (20260717075717_encrypt_integration_connection_tokens.sql)
 *
 * expand/contract の expand フェーズ中は、平文列と暗号化列が両方存在する:
 *   - 読み: 暗号化列があれば復号して使う。無ければ平文列へフォールバックする
 *     (マイグレーション適用前の現行デプロイ / 適用〜デプロイ間に作られた新規接続)。
 *   - 書き: 両方へ書く。平文列を読んでいる現行デプロイを壊さないため。
 * 平文列のDROPと平文書き込みの停止は contract フェーズ(後続PR)で行う。
 */
describe('トークン暗号化 (expandフェーズ: 暗号化列を優先し平文へフォールバック)', () => {
  const ENCRYPTED_CONNECTION = {
    ...ACTIVE_CONNECTION,
    access_token: 'stale-plaintext',
    refresh_token: 'stale-plaintext-refresh',
    access_token_encrypted: 'enc(real-access-token)',
    refresh_token_encrypted: 'enc(real-refresh-token)',
    token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
  }

  it('暗号化列があれば復号した値をaccess_tokenとして返す(平文列は見ない)', async () => {
    selectResponse = { data: ENCRYPTED_CONNECTION, error: null }
    const connection = await refreshIfNeeded(CONNECTION_ID, vi.fn())
    expect(connection?.access_token).toBe('real-access-token')
  })

  it('暗号化列が無ければ平文列へフォールバックする(マイグレーション適用前でも動く)', async () => {
    selectResponse = {
      data: { ...ACTIVE_CONNECTION, token_expires_at: new Date(Date.now() + 3600_000).toISOString() },
      error: null,
    }
    const connection = await refreshIfNeeded(CONNECTION_ID, vi.fn())
    expect(connection?.access_token).toBe('old-access-token')
  })

  it('復号に失敗したら(鍵ローテ等)平文列へフォールバックする', async () => {
    selectResponse = {
      data: {
        ...ACTIVE_CONNECTION,
        access_token_encrypted: 'GARBAGE_NOT_DECRYPTABLE',
        token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
      },
      error: null,
    }
    const connection = await refreshIfNeeded(CONNECTION_ID, vi.fn())
    expect(connection?.access_token).toBe('old-access-token')
  })

  it('refresh_tokenも暗号化列を優先して復号し、refreshFnへ渡す', async () => {
    selectResponse = {
      data: { ...ENCRYPTED_CONNECTION, token_expires_at: new Date(Date.now() - 60_000).toISOString() },
      error: null,
    }
    updateResponse = { data: ENCRYPTED_CONNECTION, error: null }
    const refreshFn = vi.fn().mockResolvedValue({
      accessToken: 'new-access-token',
      refreshToken: null,
      expiresAt: new Date(Date.now() + 3600_000),
    })
    await refreshIfNeeded(CONNECTION_ID, refreshFn)
    expect(refreshFn).toHaveBeenCalledWith('real-refresh-token')
  })

  it('refresh成功時、access_tokenを暗号化列と平文列の両方へ書く', async () => {
    updateResponse = { data: ENCRYPTED_CONNECTION, error: null }
    const refreshFn = vi.fn().mockResolvedValue({
      accessToken: 'new-access-token',
      refreshToken: null,
      expiresAt: new Date(Date.now() + 3600_000),
    })
    await refreshIfNeeded(CONNECTION_ID, refreshFn)

    const updateArg = updateSpy.mock.calls[0][0] as Record<string, unknown>
    expect(updateArg.access_token_encrypted).toBe('enc(new-access-token)')
    expect(updateArg.access_token).toBe('new-access-token')
  })

  it('refresh_tokenがローテートされたら暗号化列と平文列の両方へ書く', async () => {
    updateResponse = { data: ENCRYPTED_CONNECTION, error: null }
    const refreshFn = vi.fn().mockResolvedValue({
      accessToken: 'new-access-token',
      refreshToken: 'rotated-refresh-token',
      expiresAt: new Date(Date.now() + 3600_000),
    })
    await refreshIfNeeded(CONNECTION_ID, refreshFn)

    const updateArg = updateSpy.mock.calls[0][0] as Record<string, unknown>
    expect(updateArg.refresh_token_encrypted).toBe('enc(rotated-refresh-token)')
    expect(updateArg.refresh_token).toBe('rotated-refresh-token')
  })

  it('【回帰】refresh_tokenが返らなければ暗号化列も平文列も上書きしない', async () => {
    updateResponse = { data: ENCRYPTED_CONNECTION, error: null }
    const refreshFn = vi.fn().mockResolvedValue({
      accessToken: 'new-access-token',
      refreshToken: null,
      expiresAt: new Date(Date.now() + 3600_000),
    })
    await refreshIfNeeded(CONNECTION_ID, refreshFn)

    const updateArg = updateSpy.mock.calls[0][0] as Record<string, unknown>
    expect(updateArg).not.toHaveProperty('refresh_token')
    expect(updateArg).not.toHaveProperty('refresh_token_encrypted')
  })

  it('refresh後に返すconnectionも復号済みのaccess_tokenを持つ', async () => {
    updateResponse = { data: { ...ENCRYPTED_CONNECTION, access_token_encrypted: 'enc(new-access-token)' }, error: null }
    const refreshFn = vi.fn().mockResolvedValue({
      accessToken: 'new-access-token',
      refreshToken: null,
      expiresAt: new Date(Date.now() + 3600_000),
    })
    const connection = await refreshIfNeeded(CONNECTION_ID, refreshFn)
    expect(connection?.access_token).toBe('new-access-token')
  })

  it('getValidTokenDetailedも復号済みトークンを返す', async () => {
    selectResponse = { data: ENCRYPTED_CONNECTION, error: null }
    const result = await getValidTokenDetailed(CONNECTION_ID, vi.fn())
    expect(result).toEqual({ status: 'ok', token: 'real-access-token' })
  })
})
