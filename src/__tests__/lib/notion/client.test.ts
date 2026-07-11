import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * exchangeNotionCode — Notion OAuthのトークン交換(Basic認証、無期限トークン)。
 * AI_SECRETARY_STAGE3_INTEGRATIONS.md §1-1 / PR-3仕様: refresh_tokenなし。
 */

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NOTION_CLIENT_ID = 'client-id-1'
  process.env.NOTION_CLIENT_SECRET = 'client-secret-1'
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com'
  delete process.env.NOTION_REDIRECT_URI
})

describe('exchangeNotionCode', () => {
  it('POSTs to the token endpoint with Basic auth and returns mapped tokens (no refresh_token)', async () => {
    const { exchangeNotionCode } = await import('@/lib/notion/client')

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'secret_abc',
        workspace_id: 'ws-1',
        workspace_name: 'Acme Workspace',
        workspace_icon: 'https://example.com/icon.png',
        bot_id: 'bot-1',
      }),
    })

    const tokens = await exchangeNotionCode('auth-code-1')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.notion.com/v1/oauth/token')
    expect(init.method).toBe('POST')
    expect(init.headers['Authorization']).toBe(
      `Basic ${Buffer.from('client-id-1:client-secret-1').toString('base64')}`,
    )
    expect(init.headers['Content-Type']).toBe('application/json')

    const body = JSON.parse(init.body)
    expect(body).toEqual({
      grant_type: 'authorization_code',
      code: 'auth-code-1',
      redirect_uri: 'https://app.example.com/api/integrations/callback/notion',
    })

    expect(tokens).toEqual({
      accessToken: 'secret_abc',
      workspaceId: 'ws-1',
      workspaceName: 'Acme Workspace',
      workspaceIcon: 'https://example.com/icon.png',
      botId: 'bot-1',
    })
    // Notionトークンは無期限: refreshToken/expiresAtに相当するフィールドを持たない
    expect(tokens).not.toHaveProperty('refreshToken')
    expect(tokens).not.toHaveProperty('expiresAt')
  })

  it('throws with the response status when the exchange fails', async () => {
    const { exchangeNotionCode } = await import('@/lib/notion/client')
    fetchMock.mockResolvedValue({ ok: false, status: 400, text: async () => 'invalid_grant' })

    await expect(exchangeNotionCode('bad-code')).rejects.toThrow('Notion token exchange failed (400)')
  })
})
