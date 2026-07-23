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
  createChatSubscription,
  renewChatSubscription,
  deleteChatSubscription,
  ChatSubscriptionAlreadyExistsUnresolvedError,
  __resetChatAccessTokenCacheForTests,
} from '@/lib/channels/google-chat/client'

const CLIENT_EMAIL = 'chat-app-sa@example-project.iam.gserviceaccount.com'
const ORIGINAL_ENV = process.env.GOOGLE_CHAT_SA_KEY
const ORIGINAL_TOPIC_ENV = process.env.GOOGLE_CHAT_PUBSUB_TOPIC

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
  process.env.GOOGLE_CHAT_PUBSUB_TOPIC = 'projects/example-project/topics/chat-events'
})

afterEach(() => {
  __resetChatAccessTokenCacheForTests()
  if (ORIGINAL_ENV === undefined) delete process.env.GOOGLE_CHAT_SA_KEY
  else process.env.GOOGLE_CHAT_SA_KEY = ORIGINAL_ENV
  if (ORIGINAL_TOPIC_ENV === undefined) delete process.env.GOOGLE_CHAT_PUBSUB_TOPIC
  else process.env.GOOGLE_CHAT_PUBSUB_TOPIC = ORIGINAL_TOPIC_ENV
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

// ---------------------------------------------------------------------------
// PR-d: Workspace Events API 購読管理
// ---------------------------------------------------------------------------

interface SubscriptionFetchOpts {
  createStatus?: number
  createBody?: unknown
  listStatus?: number
  listBody?: unknown
  patchStatus?: number
  patchBody?: unknown
  deleteStatus?: number
}

function makeSubscriptionFetchMock(opts?: SubscriptionFetchOpts) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'events-access-token-1', expires_in: 3600 }),
      } as unknown as Response
    }
    if (url === 'https://workspaceevents.googleapis.com/v1/subscriptions' && init?.method === 'POST') {
      const status = opts?.createStatus ?? 200
      const body = opts?.createBody ?? { name: 'subscriptions/SUB-1', expireTime: '2026-08-01T00:00:00.000Z' }
      return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => JSON.stringify(body),
        json: async () => body,
      } as unknown as Response
    }
    if (url.startsWith('https://workspaceevents.googleapis.com/v1/subscriptions?filter=')) {
      const status = opts?.listStatus ?? 200
      const body = opts?.listBody ?? { subscriptions: [] }
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
      } as unknown as Response
    }
    if (url.includes('updateMask=ttl') && init?.method === 'PATCH') {
      const status = opts?.patchStatus ?? 200
      const body = opts?.patchBody ?? { expireTime: '2026-08-08T00:00:00.000Z' }
      return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => JSON.stringify(body),
        json: async () => body,
      } as unknown as Response
    }
    if (url.startsWith('https://workspaceevents.googleapis.com/v1/subscriptions/') && init?.method === 'DELETE') {
      const status = opts?.deleteStatus ?? 200
      return { ok: status >= 200 && status < 300, status, text: async () => '' } as unknown as Response
    }
    throw new Error(`unexpected fetch url in test: ${url} ${init?.method}`)
  })
}

describe('createChatSubscription', () => {
  it('正しいURL/Bearer/bodyでPOSTし name/expireTime を返す', async () => {
    const fetchMock = makeSubscriptionFetchMock()
    const result = await createChatSubscription('spaces/S1', fetchMock as unknown as typeof fetch)
    expect(result).toEqual({ name: 'subscriptions/SUB-1', expireTime: '2026-08-01T00:00:00.000Z' })

    const call = fetchMock.mock.calls.find(
      ([url]) => String(url) === 'https://workspaceevents.googleapis.com/v1/subscriptions',
    )
    expect(call).toBeDefined()
    const [url, init] = call!
    expect(url).toBe('https://workspaceevents.googleapis.com/v1/subscriptions')
    expect(init?.method).toBe('POST')
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer events-access-token-1')
    expect(JSON.parse(String(init?.body))).toEqual({
      targetResource: 'spaces/S1',
      eventTypes: ['google.workspace.chat.message.v1.created'],
      notificationEndpoint: { pubsubTopic: 'projects/example-project/topics/chat-events' },
      payloadOptions: { includeResource: true },
      ttl: '0s',
    })
  })

  it('GOOGLE_CHAT_PUBSUB_TOPIC未設定は例外(fetchは呼ばれない)', async () => {
    delete process.env.GOOGLE_CHAT_PUBSUB_TOPIC
    const fetchMock = makeSubscriptionFetchMock()
    await expect(
      createChatSubscription('spaces/S1', fetchMock as unknown as typeof fetch),
    ).rejects.toThrow(/GOOGLE_CHAT_PUBSUB_TOPIC/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ALREADY_EXISTS(409)は成功扱いにし、list APIで既存購読名を回収して返す', async () => {
    const fetchMock = makeSubscriptionFetchMock({
      createStatus: 409,
      createBody: { error: { status: 'ALREADY_EXISTS', message: 'already exists' } },
      listBody: { subscriptions: [{ name: 'subscriptions/EXISTING-1', expireTime: '2026-08-02T00:00:00.000Z' }] },
    })
    const result = await createChatSubscription('spaces/S1', fetchMock as unknown as typeof fetch)
    expect(result).toEqual({ name: 'subscriptions/EXISTING-1', expireTime: '2026-08-02T00:00:00.000Z' })

    const listCall = fetchMock.mock.calls.find(([url]) =>
      String(url).startsWith('https://workspaceevents.googleapis.com/v1/subscriptions?filter='),
    )
    expect(listCall).toBeDefined()
    expect(String(listCall![0])).toContain(encodeURIComponent('target_resource="spaces/S1"'))
  })

  it('ALREADY_EXISTSでもlistで解決できなければ ChatSubscriptionAlreadyExistsUnresolvedError', async () => {
    const fetchMock = makeSubscriptionFetchMock({
      createStatus: 409,
      createBody: { error: { status: 'ALREADY_EXISTS' } },
      listBody: { subscriptions: [] },
    })
    await expect(
      createChatSubscription('spaces/S1', fetchMock as unknown as typeof fetch),
    ).rejects.toBeInstanceOf(ChatSubscriptionAlreadyExistsUnresolvedError)
  })

  it('ALREADY_EXISTS以外のエラーはそのまま例外', async () => {
    const fetchMock = makeSubscriptionFetchMock({
      createStatus: 403,
      createBody: { error: { status: 'PERMISSION_DENIED' } },
    })
    await expect(
      createChatSubscription('spaces/S1', fetchMock as unknown as typeof fetch),
    ).rejects.toThrow(/subscription create failed \(403\)/)
  })
})

describe('renewChatSubscription', () => {
  it('PATCH updateMask=ttl で ttl=0s を送り expireTime を返す', async () => {
    const fetchMock = makeSubscriptionFetchMock({
      patchBody: { expireTime: '2026-09-01T00:00:00.000Z' },
    })
    const result = await renewChatSubscription(
      'subscriptions/SUB-1',
      fetchMock as unknown as typeof fetch,
    )
    expect(result).toEqual({ expireTime: '2026-09-01T00:00:00.000Z' })

    const call = fetchMock.mock.calls.find(([url]) => String(url).includes('updateMask=ttl'))
    expect(call).toBeDefined()
    const [url, init] = call!
    expect(url).toBe('https://workspaceevents.googleapis.com/v1/subscriptions/SUB-1?updateMask=ttl')
    expect(init?.method).toBe('PATCH')
    expect(JSON.parse(String(init?.body))).toEqual({ ttl: '0s' })
  })

  it('4xxなど非2xxは例外', async () => {
    const fetchMock = makeSubscriptionFetchMock({ patchStatus: 404, patchBody: { error: { status: 'NOT_FOUND' } } })
    await expect(
      renewChatSubscription('subscriptions/SUB-1', fetchMock as unknown as typeof fetch),
    ).rejects.toThrow(/subscription renew failed \(404\)/)
  })
})

describe('deleteChatSubscription', () => {
  it('正しいURL/メソッドでDELETEする', async () => {
    const fetchMock = makeSubscriptionFetchMock()
    await deleteChatSubscription('subscriptions/SUB-1', fetchMock as unknown as typeof fetch)
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/subscriptions/SUB-1'))
    expect(call).toBeDefined()
    expect(call![1]?.method).toBe('DELETE')
  })

  it('404(既に無い)は成功扱い', async () => {
    const fetchMock = makeSubscriptionFetchMock({ deleteStatus: 404 })
    await expect(
      deleteChatSubscription('subscriptions/SUB-1', fetchMock as unknown as typeof fetch),
    ).resolves.toBeUndefined()
  })

  it('404以外の非2xxは例外', async () => {
    const fetchMock = makeSubscriptionFetchMock({ deleteStatus: 500 })
    await expect(
      deleteChatSubscription('subscriptions/SUB-1', fetchMock as unknown as typeof fetch),
    ).rejects.toThrow(/subscription delete failed \(500\)/)
  })
})
