// @vitest-environment node
//
// jose の SignJWT/importPKCS8/generateKeyPair は WebCrypto を使う。jsdom(既定environment)は
// 独自realmのUint8Array/CryptoKeyを持つため instanceof チェックが失敗する
// （verify.test.ts と同じ理由でnode環境に切り替える）。
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { generateKeyPair, exportPKCS8 } from 'jose'
import {
  getChatAccessToken,
  sendChatMessage,
  __resetChatAccessTokenCacheForTests,
} from '@/lib/channels/google-chat/client'

const CLIENT_EMAIL = 'chat-app-sa@example-project.iam.gserviceaccount.com'
const ORIGINAL_ENV = process.env.GOOGLE_CHAT_SA_KEY

let privateKeyPem: string

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true })
  privateKeyPem = await exportPKCS8(pair.privateKey)
})

beforeEach(() => {
  __resetChatAccessTokenCacheForTests()
  process.env.GOOGLE_CHAT_SA_KEY = JSON.stringify({
    client_email: CLIENT_EMAIL,
    private_key: privateKeyPem,
  })
})

afterEach(() => {
  __resetChatAccessTokenCacheForTests()
  if (ORIGINAL_ENV === undefined) delete process.env.GOOGLE_CHAT_SA_KEY
  else process.env.GOOGLE_CHAT_SA_KEY = ORIGINAL_ENV
})

function makeFetchMock(opts?: {
  tokenOk?: boolean
  tokenExpiresIn?: number
  messagesOk?: boolean
  messageName?: string
}) {
  const tokenOk = opts?.tokenOk ?? true
  const messagesOk = opts?.messagesOk ?? true
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      if (!tokenOk) {
        return {
          ok: false,
          status: 400,
          text: async () => 'invalid_grant',
        } as unknown as Response
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'access-token-1',
          expires_in: opts?.tokenExpiresIn ?? 3600,
        }),
      } as unknown as Response
    }
    if (url.startsWith('https://chat.googleapis.com/v1/')) {
      if (!messagesOk) {
        return { ok: false, status: 403, text: async () => 'forbidden' } as unknown as Response
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ name: opts?.messageName ?? 'spaces/S1/messages/M-out-1' }),
      } as unknown as Response
    }
    throw new Error(`unexpected fetch url in test: ${url} ${init?.method}`)
  })
}

describe('getChatAccessToken', () => {
  it('SA鍵でJWT署名しtoken endpointと交換してaccess_tokenを返す', async () => {
    const fetchMock = makeFetchMock()
    const token = await getChatAccessToken(fetchMock as unknown as typeof fetch)
    expect(token).toBe('access-token-1')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://oauth2.googleapis.com/token')
    expect(init?.method).toBe('POST')
    const body = String(init?.body)
    expect(body).toContain('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer')
    expect(body).toContain('assertion=')
  })

  it('exp手前まではキャッシュを再利用し、token endpointを再度叩かない', async () => {
    const fetchMock = makeFetchMock()
    const t1 = await getChatAccessToken(fetchMock as unknown as typeof fetch)
    const t2 = await getChatAccessToken(fetchMock as unknown as typeof fetch)
    expect(t1).toBe(t2)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('失効間近(安全マージン内)のキャッシュは再利用せず取り直す', async () => {
    const fetchMock = makeFetchMock({ tokenExpiresIn: 30 }) // 安全マージン60秒未満=即キャッシュ切れ扱い
    await getChatAccessToken(fetchMock as unknown as typeof fetch)
    await getChatAccessToken(fetchMock as unknown as typeof fetch)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('GOOGLE_CHAT_SA_KEY未設定は例外', async () => {
    delete process.env.GOOGLE_CHAT_SA_KEY
    const fetchMock = makeFetchMock()
    await expect(getChatAccessToken(fetchMock as unknown as typeof fetch)).rejects.toThrow(
      /GOOGLE_CHAT_SA_KEY/,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('GOOGLE_CHAT_SA_KEYが不正JSONは例外', async () => {
    process.env.GOOGLE_CHAT_SA_KEY = '{not-json'
    const fetchMock = makeFetchMock()
    await expect(getChatAccessToken(fetchMock as unknown as typeof fetch)).rejects.toThrow(
      /GOOGLE_CHAT_SA_KEY/,
    )
  })

  it('client_email/private_key欠落は例外', async () => {
    process.env.GOOGLE_CHAT_SA_KEY = JSON.stringify({ client_email: CLIENT_EMAIL })
    const fetchMock = makeFetchMock()
    await expect(getChatAccessToken(fetchMock as unknown as typeof fetch)).rejects.toThrow(
      /GOOGLE_CHAT_SA_KEY/,
    )
  })

  it('token endpointが失敗(非2xx)なら例外', async () => {
    const fetchMock = makeFetchMock({ tokenOk: false })
    await expect(getChatAccessToken(fetchMock as unknown as typeof fetch)).rejects.toThrow(
      /token exchange failed/,
    )
  })
})

describe('sendChatMessage', () => {
  it('正しいURL/Bearer/bodyでPOSTしmessageNameを返す', async () => {
    const fetchMock = makeFetchMock({ messageName: 'spaces/S1/messages/M-out-9' })
    const result = await sendChatMessage('spaces/S1', 'タスクを完了にしました。', fetchMock as unknown as typeof fetch)
    expect(result).toEqual({ messageName: 'spaces/S1/messages/M-out-9' })

    const call = fetchMock.mock.calls.find(([url]) => String(url).startsWith('https://chat.googleapis.com'))
    expect(call).toBeDefined()
    const [url, init] = call!
    expect(url).toBe('https://chat.googleapis.com/v1/spaces/S1/messages')
    expect(init?.method).toBe('POST')
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer access-token-1')
    expect(JSON.parse(String(init?.body))).toEqual({ text: 'タスクを完了にしました。' })
  })

  it('送信APIが失敗してもthrowせずmessageName:nullを返す', async () => {
    const fetchMock = makeFetchMock({ messagesOk: false })
    const result = await sendChatMessage('spaces/S1', 'hello', fetchMock as unknown as typeof fetch)
    expect(result).toEqual({ messageName: null })
  })

  it('SA鍵未設定でもthrowせずmessageName:nullを返す（呼び元は完了記録を優先）', async () => {
    delete process.env.GOOGLE_CHAT_SA_KEY
    const fetchMock = makeFetchMock()
    const result = await sendChatMessage('spaces/S1', 'hello', fetchMock as unknown as typeof fetch)
    expect(result).toEqual({ messageName: null })
  })
})
