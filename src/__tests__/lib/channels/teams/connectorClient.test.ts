import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getAppToken,
  sendTeamsReply,
  __resetAppTokenCacheForTest,
} from '@/lib/channels/teams/connectorClient'

const APP_ID = 'app-id-1'
const APP_PASSWORD = 'app-secret-1'
const SERVICE_URL = 'https://smba.trafficmanager.net/amer/'
const CONVERSATION_ID = '19:abcd1234@thread.tacv2;messageid=1234567890'

function makeTokenFetchMock(opts?: { ok?: boolean; expiresIn?: number; accessToken?: string }) {
  const ok = opts?.ok ?? true
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url === 'https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token') {
      if (!ok) {
        return { ok: false, status: 400, text: async () => 'invalid_client' } as unknown as Response
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: opts?.accessToken ?? 'app-token-1',
          expires_in: opts?.expiresIn ?? 3600,
        }),
      } as unknown as Response
    }
    throw new Error(`unexpected fetch url in test: ${url}`)
  })
}

beforeEach(() => {
  __resetAppTokenCacheForTest()
})

describe('getAppToken', () => {
  it('client_credentialsでトークンendpointを叩きaccess_tokenを返す。secretはbody(form)のみに載る', async () => {
    const fetchMock = makeTokenFetchMock()
    const token = await getAppToken(APP_ID, APP_PASSWORD, fetchMock as unknown as typeof fetch)
    expect(token).toBe('app-token-1')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token')
    expect(init?.method).toBe('POST')
    // secretはクエリ(URL)には絶対に載らない
    expect(url).not.toContain(APP_PASSWORD)
    const body = String(init?.body)
    expect(body).toContain(`client_id=${APP_ID}`)
    expect(body).toContain('client_secret=')
    expect(body).toContain('grant_type=client_credentials')
    expect(body).toContain('scope=https%3A%2F%2Fapi.botframework.com%2F.default')
  })

  it('exp手前まではキャッシュを再利用し、token endpointを再度叩かない', async () => {
    const fetchMock = makeTokenFetchMock()
    const t1 = await getAppToken(APP_ID, APP_PASSWORD, fetchMock as unknown as typeof fetch)
    const t2 = await getAppToken(APP_ID, APP_PASSWORD, fetchMock as unknown as typeof fetch)
    expect(t1).toBe(t2)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('失効間近(安全マージン内)のキャッシュは再利用せず取り直す', async () => {
    const fetchMock = makeTokenFetchMock({ expiresIn: 20 }) // 30秒の安全マージン未満=即キャッシュ切れ扱い
    await getAppToken(APP_ID, APP_PASSWORD, fetchMock as unknown as typeof fetch)
    await getAppToken(APP_ID, APP_PASSWORD, fetchMock as unknown as typeof fetch)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('token endpointが失敗(非2xx)なら例外', async () => {
    const fetchMock = makeTokenFetchMock({ ok: false })
    await expect(
      getAppToken(APP_ID, APP_PASSWORD, fetchMock as unknown as typeof fetch),
    ).rejects.toThrow(/token request failed/)
  })

  it('access_token欠落のレスポンスは例外', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }) as unknown as Response)
    await expect(
      getAppToken(APP_ID, APP_PASSWORD, fetchMock as unknown as typeof fetch),
    ).rejects.toThrow(/missing access_token/)
  })
})

describe('sendTeamsReply', () => {
  function makeReplyFetchMock(opts?: { ok?: boolean }) {
    const ok = opts?.ok ?? true
    return vi.fn(async (_url: string, _init?: RequestInit) =>
      ok
        ? ({ ok: true, status: 200, json: async () => ({ id: 'out-1' }) } as unknown as Response)
        : ({ ok: false, status: 403, text: async () => 'forbidden' } as unknown as Response),
    )
  }

  it('正しいURL・Bearerヘッダ・bodyでPOSTする', async () => {
    const fetchMock = makeReplyFetchMock()
    const getToken = vi.fn().mockResolvedValue('bearer-token-1')
    const result = await sendTeamsReply(
      { serviceUrl: SERVICE_URL, conversationId: CONVERSATION_ID, text: 'このチャンネルを登録しました。' },
      { getToken, fetchImpl: fetchMock as unknown as typeof fetch },
    )
    expect(result).toEqual({ ok: true })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(
      `https://smba.trafficmanager.net/amer/v3/conversations/${encodeURIComponent(CONVERSATION_ID)}/activities`,
    )
    expect(init?.method).toBe('POST')
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer bearer-token-1')
    expect(JSON.parse(String(init?.body))).toEqual({ type: 'message', text: 'このチャンネルを登録しました。' })
  })

  it('★トークンはヘッダのみに載り、URL/クエリには一切現れない', async () => {
    const fetchMock = makeReplyFetchMock()
    const getToken = vi.fn().mockResolvedValue('secret-bearer-token-xyz')
    await sendTeamsReply(
      { serviceUrl: SERVICE_URL, conversationId: CONVERSATION_ID, text: 'hello' },
      { getToken, fetchImpl: fetchMock as unknown as typeof fetch },
    )
    const [url] = fetchMock.mock.calls[0]
    expect(String(url)).not.toContain('secret-bearer-token-xyz')
  })

  it('serviceUrlは引数で渡されたものだけを使う（余分な末尾スラッシュは1つに畳む）', async () => {
    const fetchMock = makeReplyFetchMock()
    const getToken = vi.fn().mockResolvedValue('t')
    await sendTeamsReply(
      { serviceUrl: 'https://smba.trafficmanager.net/amer//', conversationId: CONVERSATION_ID, text: 'hi' },
      { getToken, fetchImpl: fetchMock as unknown as typeof fetch },
    )
    const [url] = fetchMock.mock.calls[0]
    expect(url).toBe(
      `https://smba.trafficmanager.net/amer/v3/conversations/${encodeURIComponent(CONVERSATION_ID)}/activities`,
    )
  })

  it('送信APIが失敗してもthrowせず ok:false を返す（best-effort）', async () => {
    const fetchMock = makeReplyFetchMock({ ok: false })
    const getToken = vi.fn().mockResolvedValue('t')
    const result = await sendTeamsReply(
      { serviceUrl: SERVICE_URL, conversationId: CONVERSATION_ID, text: 'hi' },
      { getToken, fetchImpl: fetchMock as unknown as typeof fetch },
    )
    expect(result).toEqual({ ok: false, error: expect.stringContaining('403') })
  })

  it('getTokenが例外を投げてもthrowせず ok:false を返す', async () => {
    const getToken = vi.fn().mockRejectedValue(new Error('token unavailable'))
    const result = await sendTeamsReply(
      { serviceUrl: SERVICE_URL, conversationId: CONVERSATION_ID, text: 'hi' },
      { getToken },
    )
    expect(result).toEqual({ ok: false, error: 'token unavailable' })
  })
})
