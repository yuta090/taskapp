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

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ from: fromMock })),
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

beforeEach(() => {
  vi.clearAllMocks()
  fromCalls.length = 0
  selectResponse = { data: ACTIVE_CONNECTION, error: null }
  updateResponse = { data: null, error: null }
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.example.com'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'

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
