import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * zoom / teams プロバイダの getUserAccessToken — integration_connections から
 * ユーザーOAuthトークンを取得する独立読み取り経路(token-manager を経由しない)。
 *
 * contract フェーズの回帰:
 *   - トークンは暗号化列(access_token_encrypted/refresh_token_encrypted)から復号する。
 *   - 平文列へのフォールバック(`?? conn.access_token`)は撤去した(M2 で平文は空化される)。
 *   - select は平文 access_token/refresh_token 列を要求しない(暗号列と id/expiry のみ)。
 */

const fromMock = vi.fn()
let selectArg: string | undefined

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ from: fromMock })),
}))

const decryptTokenMock = vi.fn()
vi.mock('@/lib/integrations/token-crypto', () => ({
  decryptToken: (...args: unknown[]) => decryptTokenMock(...args),
}))

// buildTokenColumns は refresh 書き込み時のみ使う(このテストは有効期限内で refresh しない)。
vi.mock('@/lib/integrations/token-manager', () => ({
  buildTokenColumns: vi.fn(async () => ({})),
}))
vi.mock('@/lib/zoom/client', () => ({ refreshZoomToken: vi.fn() }))
vi.mock('@/lib/teams/client', () => ({ refreshTeamsToken: vi.fn() }))

const { ZoomProvider } = await import('@/lib/video-conference/providers/zoom')
const { TeamsProvider } = await import('@/lib/video-conference/providers/teams')

type PrivateProvider = { getUserAccessToken(userId: string): Promise<string | null> }

function mockConnRow(row: Record<string, unknown> | null) {
  fromMock.mockImplementation(() => {
    const builder: Record<string, unknown> = {}
    builder.select = vi.fn((arg: string) => {
      selectArg = arg
      return builder
    })
    builder.eq = vi.fn(() => builder)
    builder.single = vi.fn(() => Promise.resolve({ data: row, error: null }))
    return builder
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  selectArg = undefined
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.example.com'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
})

const FUTURE = new Date(Date.now() + 3600_000).toISOString()

describe.each([
  ['zoom', () => new ZoomProvider() as unknown as PrivateProvider],
  ['teams', () => new TeamsProvider() as unknown as PrivateProvider],
])('%s getUserAccessToken (contract: 暗号列のみ)', (_name, make) => {
  it('暗号化列を復号してaccess_tokenを返す(有効期限内)', async () => {
    mockConnRow({
      id: 'conn-1',
      access_token_encrypted: 'ACCESS_ENC',
      refresh_token_encrypted: 'REFRESH_ENC',
      token_expires_at: FUTURE,
    })
    decryptTokenMock.mockImplementation(async (enc: string) =>
      enc === 'ACCESS_ENC' ? 'fresh-access' : 'fresh-refresh',
    )
    const token = await make().getUserAccessToken('u1')
    expect(token).toBe('fresh-access')
  })

  it('【回帰】暗号化列が復号できなければ平文列へフォールバックしない(nullを返す)', async () => {
    mockConnRow({
      id: 'conn-1',
      // 平文列が行に紛れていても使わない(select はそもそも取得しないが、防御的に確認)。
      access_token: 'STALE-PLAINTEXT',
      refresh_token: 'STALE-PLAINTEXT-REFRESH',
      access_token_encrypted: 'PERM_NULL',
      refresh_token_encrypted: 'PERM_NULL',
      token_expires_at: FUTURE,
    })
    decryptTokenMock.mockResolvedValue(null)
    const token = await make().getUserAccessToken('u1')
    expect(token).toBeNull()
  })

  it('select句に平文access_token/refresh_token列を要求しない(暗号列で解決)', async () => {
    mockConnRow(null)
    await make().getUserAccessToken('u1')
    expect(selectArg).not.toMatch(/(^|[,\s])access_token([,\s]|$)/)
    expect(selectArg).not.toMatch(/(^|[,\s])refresh_token([,\s]|$)/)
    expect(selectArg).toContain('access_token_encrypted')
    expect(selectArg).toContain('refresh_token_encrypted')
  })
})
