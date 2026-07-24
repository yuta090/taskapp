import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { deliverToChannel } from '@/lib/channels/adapters'
import { lineAdapter } from '@/lib/channels/adapters/line'
import { slackAdapter } from '@/lib/channels/adapters/slack'
import { chatworkAdapter } from '@/lib/channels/adapters/chatwork'
import { telegramAdapter } from '@/lib/channels/adapters/telegram'
import { discordAdapter } from '@/lib/channels/adapters/discord'
import { googleChatAdapter } from '@/lib/channels/adapters/googleChat'
import { teamsAdapter } from '@/lib/channels/adapters/teams'
import { whatsappAdapter } from '@/lib/channels/adapters/whatsapp'
import { messengerAdapter } from '@/lib/channels/adapters/messenger'
import { isAllowedWebhookUrl } from '@/lib/channels/adapters/webhookUrl'
import { classifyStatus } from '@/lib/channels/adapters/types'

const sendChatMessageMock = vi.fn()
vi.mock('@/lib/channels/google-chat/client', () => ({
  sendChatMessage: (...args: unknown[]) => sendChatMessageMock(...args),
}))

const getAppTokenMock = vi.fn()
const sendTeamsProactiveMock = vi.fn()
vi.mock('@/lib/channels/teams/connectorClient', () => ({
  getAppToken: (...args: unknown[]) => getAppTokenMock(...args),
  sendTeamsProactiveToChannel: (...args: unknown[]) => sendTeamsProactiveMock(...args),
}))

function mockFetch(impl: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const fn = vi.fn(impl)
  vi.stubGlobal('fetch', fn as unknown as typeof fetch)
  return fn
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

beforeEach(() => vi.restoreAllMocks())
afterEach(() => vi.unstubAllGlobals())

describe('classifyStatus', () => {
  it('429/5xx は一時、4xx設定不備は恒久', () => {
    expect(classifyStatus(429).permanent).toBe(false)
    expect(classifyStatus(500).permanent).toBe(false)
    expect(classifyStatus(401).permanent).toBe(true)
    expect(classifyStatus(404).permanent).toBe(true)
    expect(classifyStatus(422).permanent).toBe(true)
  })
})

describe('lineAdapter', () => {
  it('access_token 欠落は恒久失敗', async () => {
    const r = await lineAdapter({ credentials: {}, to: 'U1', text: 'hi' })
    expect(r).toMatchObject({ ok: false, permanent: true })
  })

  it('rich未指定はtextだけのtextメッセージを送る（既存呼び出し元の後方互換）', async () => {
    const fetchFn = mockFetch(() => new Response('{}', { status: 200 }))
    const r = await lineAdapter({ credentials: { access_token: 'tok' }, to: 'U1', text: 'hello' })
    expect(r.ok).toBe(true)
    const body = JSON.parse((fetchFn.mock.calls[0][1] as RequestInit).body as string)
    expect(body.messages).toEqual([{ type: 'text', text: 'hello' }])
  })

  it('richが配列ならそのままmessagesとして送る（LINEの送信バイト列は変えない・秘書送信境界のFlex等）', async () => {
    const fetchFn = mockFetch(() => new Response('{}', { status: 200 }))
    const flex = { type: 'flex', altText: '通知', contents: { type: 'bubble' } }
    const r = await lineAdapter({
      credentials: { access_token: 'tok' },
      to: 'U1',
      text: 'この床テキストはrich指定時は使われない',
      rich: [{ type: 'text', text: '本文' }, flex],
    })
    expect(r.ok).toBe(true)
    const body = JSON.parse((fetchFn.mock.calls[0][1] as RequestInit).body as string)
    expect(body.messages).toEqual([{ type: 'text', text: '本文' }, flex])
  })

  it('pushLineMessageはexternalMessageIdを返さないためLINEはprovider_message_idを持たない', async () => {
    mockFetch(() => new Response('{}', { status: 200 }))
    const r = await lineAdapter({ credentials: { access_token: 'tok' }, to: 'U1', text: 'hi' })
    expect(r.externalMessageId).toBeUndefined()
  })
})

describe('slackAdapter', () => {
  it('bot_token 欠落は恒久失敗', async () => {
    const r = await slackAdapter({ credentials: {}, to: 'C1', text: 'hi' })
    expect(r).toMatchObject({ ok: false, permanent: true })
  })

  it('ok:true で成功しts を返す', async () => {
    const fetchFn = mockFetch(() => jsonResponse(200, { ok: true, ts: '123.45' }))
    const r = await slackAdapter({ credentials: { bot_token: 'xoxb-x' }, to: 'C1', text: 'hi' })
    expect(r.ok).toBe(true)
    expect(r.externalMessageId).toBe('123.45')
    const [, init] = fetchFn.mock.calls[0]
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer xoxb-x' })
  })

  it('body.ok:false の channel_not_found は恒久失敗', async () => {
    mockFetch(() => jsonResponse(200, { ok: false, error: 'channel_not_found' }))
    const r = await slackAdapter({ credentials: { bot_token: 'xoxb-x' }, to: 'Cbad', text: 'hi' })
    expect(r).toMatchObject({ ok: false, permanent: true })
  })

  it('body.ok:false の rate限定系(ratelimited)は一時失敗', async () => {
    mockFetch(() => jsonResponse(200, { ok: false, error: 'ratelimited' }))
    const r = await slackAdapter({ credentials: { bot_token: 'xoxb-x' }, to: 'C1', text: 'hi' })
    expect(r).toMatchObject({ ok: false, permanent: false })
  })
})

describe('chatworkAdapter', () => {
  it('数字でない room_id は恒久失敗', async () => {
    const r = await chatworkAdapter({ credentials: { api_token: 't' }, to: 'abc', text: 'hi' })
    expect(r).toMatchObject({ ok: false, permanent: true })
  })

  it('X-ChatWorkToken を付けて送信し message_id を返す', async () => {
    const fetchFn = mockFetch(() => jsonResponse(200, { message_id: '9' }))
    const r = await chatworkAdapter({ credentials: { api_token: 'tok' }, to: '123', text: 'やあ' })
    expect(r.ok).toBe(true)
    expect(r.externalMessageId).toBe('9')
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toContain('/rooms/123/messages')
    expect((init as RequestInit).headers).toMatchObject({ 'X-ChatWorkToken': 'tok' })
  })
})

describe('telegramAdapter', () => {
  it('token 形式不正は恒久失敗', async () => {
    const r = await telegramAdapter({ credentials: { bot_token: 'bad' }, to: '1', text: 'hi' })
    expect(r).toMatchObject({ ok: false, permanent: true })
  })

  it('ok:true で成功', async () => {
    mockFetch(() => jsonResponse(200, { ok: true, result: { message_id: 42 } }))
    const r = await telegramAdapter({ credentials: { bot_token: '123:AAbb-_' }, to: '999', text: 'hi' })
    expect(r.ok).toBe(true)
    expect(r.externalMessageId).toBe('42')
  })

  it('chat not found(400/ok:false)は恒久失敗', async () => {
    mockFetch(() => jsonResponse(400, { ok: false, description: 'chat not found' }))
    const r = await telegramAdapter({ credentials: { bot_token: '123:AAbb' }, to: '0', text: 'hi' })
    expect(r).toMatchObject({ ok: false, permanent: true })
  })
})

describe('webhook-url adapters', () => {
  it('isAllowedWebhookUrl: https + 許可ホストのみ', () => {
    expect(isAllowedWebhookUrl('https://discord.com/api/webhooks/1/abc', ['discord.com'])).toBe(true)
    expect(isAllowedWebhookUrl('https://evil.com/x', ['discord.com'])).toBe(false)
    expect(isAllowedWebhookUrl('http://discord.com/x', ['discord.com'])).toBe(false) // 非https
    expect(isAllowedWebhookUrl('https://chat.googleapis.com/v1/spaces/x', ['chat.googleapis.com'])).toBe(true)
  })

  it('discord: 不正ホストは送信前に恒久失敗', async () => {
    const r = await discordAdapter({ credentials: { webhook_url: 'https://evil.com/x' }, to: 'g', text: 'hi' })
    expect(r).toMatchObject({ ok: false, permanent: true })
  })

  it('discord: 正当URLは content で送信', async () => {
    const fetchFn = mockFetch(() => new Response(null, { status: 204 }))
    const r = await discordAdapter({
      credentials: { webhook_url: 'https://discord.com/api/webhooks/1/abc' },
      to: 'g',
      text: 'hello',
    })
    expect(r.ok).toBe(true)
    const [, init] = fetchFn.mock.calls[0]
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ content: 'hello' })
  })

  /**
   * Discord は送信経路が2つある（PR1レビュー是正）:
   *   - 共有プラットフォームBot: credentials={bot_token} のみ。REST POST /channels/{id}/messages。
   *     docs/setup/DISCORD_GATEWAY_PROVISIONING.md のプロビジョニングは bot_token しか入れないため、
   *     webhook_url 必須にすると共有Botのグループへ digest が1通も届かなくなる。
   *   - 事務所自前のチャンネルWebhook: credentials={webhook_url}。
   * bot_token を優先する（実メッセージIDが取れる＝provider_message_id を残せる）。
   */
  it('discord: bot_token があれば共有Bot経路(REST)で送り、実メッセージIDを返す', async () => {
    const fetchFn = mockFetch(() => jsonResponse(200, { id: '1234567890' }))
    const r = await discordAdapter({
      credentials: { bot_token: 'BOT-TOKEN' },
      to: 'channel-123',
      text: 'hello',
    })
    expect(r.ok).toBe(true)
    expect(r.externalMessageId).toBe('1234567890')
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe('https://discord.com/api/v10/channels/channel-123/messages')
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bot BOT-TOKEN' })
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ content: 'hello' })
  })

  it('discord: bot_token と webhook_url の両方があれば bot_token を優先する', async () => {
    const fetchFn = mockFetch(() => jsonResponse(200, { id: '99' }))
    await discordAdapter({
      credentials: { bot_token: 'BOT-TOKEN', webhook_url: 'https://discord.com/api/webhooks/1/abc' },
      to: 'channel-123',
      text: 'hi',
    })
    expect(fetchFn.mock.calls[0][0]).toBe('https://discord.com/api/v10/channels/channel-123/messages')
  })

  it('discord: 共有Bot経路の失敗は status から恒久/一時を分類する', async () => {
    mockFetch(() => new Response(null, { status: 401 }))
    const r = await discordAdapter({ credentials: { bot_token: 'BAD' }, to: 'c', text: 'hi' })
    expect(r).toMatchObject({ ok: false, permanent: true, status: 401 })

    mockFetch(() => new Response(null, { status: 429 }))
    const r2 = await discordAdapter({ credentials: { bot_token: 'BAD' }, to: 'c', text: 'hi' })
    expect(r2).toMatchObject({ ok: false, permanent: false, status: 429 })
  })

  it('discord: bot_token も webhook_url も無ければ恒久失敗（どちらが要るか示す）', async () => {
    const r = await discordAdapter({ credentials: {}, to: 'c', text: 'hi' })
    expect(r).toMatchObject({ ok: false, permanent: true })
    expect(r.error).toContain('bot_token')
    expect(r.error).toContain('webhook_url')
  })

  it('googleChat: webhook_url があれば Incoming Webhook 経路（既存挙動）', async () => {
    const fetchFn = mockFetch(() => jsonResponse(200, {}))
    const r = await googleChatAdapter({
      credentials: { webhook_url: 'https://chat.googleapis.com/v1/spaces/x/messages?key=k' },
      to: 's',
      text: '完了',
    })
    expect(r.ok).toBe(true)
    expect(JSON.parse((fetchFn.mock.calls[0][1] as RequestInit).body as string)).toEqual({ text: '完了' })
    expect(sendChatMessageMock).not.toHaveBeenCalled()
  })

  /**
   * PR-f: platform 共有bot（SA認証・webhook_url を持たない）の報告送信の穴を塞ぐ。
   * webhook_url が無い場合は SA 送信(sendChatMessage)にフォールバックする。
   */
  it('googleChat: webhook_url が無ければ SA送信(sendChatMessage)にフォールバックし成功時は externalMessageId を返す', async () => {
    sendChatMessageMock.mockResolvedValue({ messageName: 'spaces/AAA/messages/BBB' })
    const r = await googleChatAdapter({ credentials: {}, to: 'spaces/AAA', text: '完了' })
    expect(r).toMatchObject({ ok: true, externalMessageId: 'spaces/AAA/messages/BBB' })
    expect(sendChatMessageMock).toHaveBeenCalledWith('spaces/AAA', '完了')
  })

  it('googleChat: SA送信が失敗(messageName:null)なら一時失敗として返す（再試行余地あり）', async () => {
    sendChatMessageMock.mockResolvedValue({ messageName: null })
    const r = await googleChatAdapter({ credentials: {}, to: 'spaces/AAA', text: '完了' })
    expect(r).toMatchObject({ ok: false, permanent: false })
  })

  it('googleChat: SA送信(sendChatMessage)が例外を投げても route/cron を落とさず失敗として畳む', async () => {
    sendChatMessageMock.mockRejectedValue(new Error('GOOGLE_CHAT_SA_KEY is not configured'))
    const r = await googleChatAdapter({ credentials: {}, to: 'spaces/AAA', text: '完了' })
    expect(r).toMatchObject({ ok: false, permanent: false })
  })

  it('teams: Adaptive Card で送信', async () => {
    const fetchFn = mockFetch(() => new Response('1', { status: 200 }))
    const r = await teamsAdapter({
      credentials: { webhook_url: 'https://acme.webhook.office.com/webhookb2/xxx' },
      to: 't',
      text: 'card body',
    })
    expect(r.ok).toBe(true)
    const payload = JSON.parse((fetchFn.mock.calls[0][1] as RequestInit).body as string)
    expect(payload.type).toBe('message')
    expect(payload.attachments[0].content.body[0].text).toBe('card body')
  })

  it('teams: 現行 Power Automate Workflows URL(api.powerplatform.com)を許可する', async () => {
    mockFetch(() => new Response('1', { status: 202 }))
    const r = await teamsAdapter({
      credentials: {
        webhook_url:
          'https://x.y.environment.api.powerplatform.com/powerautomate/automations/direct/workflows/abc/triggers/manual/paths/invoke?sig=SECRET',
      },
      to: 't',
      text: 'card body',
    })
    expect(r.ok).toBe(true)
  })

  it('teams: 未許可ホストは恒久失敗（SSRF防止・fetchしない）', async () => {
    const fetchFn = mockFetch(() => new Response('1', { status: 200 }))
    const r = await teamsAdapter({
      credentials: { webhook_url: 'https://evil.example.com/hook' },
      to: 't',
      text: 'x',
    })
    expect(r).toMatchObject({ ok: false, permanent: true })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  /**
   * PR-3: platform 共有bot（Bot Framework Connector・serviceUrlを持たないenvではなく per-group
   * のmetadataから受ける）の能動送信経路。webhook_urlが無ければこちらへフォールバックする
   * （googleChatAdapterのwebhook_url優先→SA経路フォールバックと同じ構造）。
   */
  describe('teams: platform proactive経路（webhook_url無し）', () => {
    const ORIGINAL_APP_ID = process.env.TEAMS_BOT_APP_ID
    const ORIGINAL_APP_PASSWORD = process.env.TEAMS_BOT_APP_PASSWORD

    beforeEach(() => {
      process.env.TEAMS_BOT_APP_ID = 'app-id-1'
      process.env.TEAMS_BOT_APP_PASSWORD = 'app-secret-1'
      getAppTokenMock.mockResolvedValue('bearer-token-1')
    })

    afterEach(() => {
      if (ORIGINAL_APP_ID === undefined) delete process.env.TEAMS_BOT_APP_ID
      else process.env.TEAMS_BOT_APP_ID = ORIGINAL_APP_ID
      if (ORIGINAL_APP_PASSWORD === undefined) delete process.env.TEAMS_BOT_APP_PASSWORD
      else process.env.TEAMS_BOT_APP_PASSWORD = ORIGINAL_APP_PASSWORD
    })

    it('webhook_url無し＋providerContext.serviceUrlありは sendTeamsProactiveToChannel を正しい引数で呼ぶ（URL/クエリにtokenは載らない）', async () => {
      sendTeamsProactiveMock.mockResolvedValue({ ok: true, externalMessageId: 'act-out-1', status: 201 })

      const r = await teamsAdapter({
        credentials: {},
        to: '19:abcd1234@thread.tacv2',
        text: '朝のまとめ',
        providerContext: { serviceUrl: 'https://smba.trafficmanager.net/amer/' },
      })

      expect(r).toEqual({ ok: true, status: 201, externalMessageId: 'act-out-1' })
      expect(sendTeamsProactiveMock).toHaveBeenCalledWith(
        {
          serviceUrl: 'https://smba.trafficmanager.net/amer/',
          channelId: '19:abcd1234@thread.tacv2',
          text: '朝のまとめ',
        },
        expect.objectContaining({ getToken: expect.any(Function) }),
      )
      // getToken経由でgetAppTokenが正しいapp資格情報で呼ばれる（envから読む・DBには置かない）
      const deps = sendTeamsProactiveMock.mock.calls[0][1] as { getToken: () => Promise<string> }
      await deps.getToken()
      expect(getAppTokenMock).toHaveBeenCalledWith('app-id-1', 'app-secret-1')
    })

    it('serviceUrl未保存（claim直後でまだ受信が無い等）は一時失敗（次回受信で入れば送れるため）', async () => {
      const r = await teamsAdapter({ credentials: {}, to: 'ch-1', text: 'x' })
      expect(r).toMatchObject({ ok: false, permanent: false })
      expect(sendTeamsProactiveMock).not.toHaveBeenCalled()
    })

    it('env(TEAMS_BOT_APP_ID/PASSWORD)欠落は一時失敗（サーバ設定待ち・cronを落とさない）', async () => {
      delete process.env.TEAMS_BOT_APP_ID
      delete process.env.TEAMS_BOT_APP_PASSWORD

      const r = await teamsAdapter({
        credentials: {},
        to: 'ch-1',
        text: 'x',
        providerContext: { serviceUrl: 'https://smba.trafficmanager.net/amer/' },
      })
      expect(r).toMatchObject({ ok: false, permanent: false })
      expect(sendTeamsProactiveMock).not.toHaveBeenCalled()
    })

    it('Connector送信自体の失敗はstatusから恒久/一時を分類する（401=恒久・429=一時）', async () => {
      sendTeamsProactiveMock.mockResolvedValue({ ok: false, status: 401, error: 'teams connectorClient: proactive send failed (401)' })
      const r1 = await teamsAdapter({
        credentials: {},
        to: 'ch-1',
        text: 'x',
        providerContext: { serviceUrl: 'https://smba.trafficmanager.net/amer/' },
      })
      expect(r1).toMatchObject({ ok: false, permanent: true, status: 401 })

      sendTeamsProactiveMock.mockResolvedValue({ ok: false, status: 429, error: 'teams connectorClient: proactive send failed (429)' })
      const r2 = await teamsAdapter({
        credentials: {},
        to: 'ch-1',
        text: 'x',
        providerContext: { serviceUrl: 'https://smba.trafficmanager.net/amer/' },
      })
      expect(r2).toMatchObject({ ok: false, permanent: false, status: 429 })
    })
  })
})

describe('whatsappAdapter', () => {
  it('access_token / phone_number_id 欠落は恒久失敗', async () => {
    expect(await whatsappAdapter({ credentials: {}, to: '+1', text: 'x' })).toMatchObject({ permanent: true })
    expect(
      await whatsappAdapter({ credentials: { access_token: 't' }, to: '+1', text: 'x' }),
    ).toMatchObject({ permanent: true })
  })

  it('成功時に message id を返す', async () => {
    mockFetch(() => jsonResponse(200, { messages: [{ id: 'wamid.X' }] }))
    const r = await whatsappAdapter({
      credentials: { access_token: 't', phone_number_id: '123' },
      to: '+819012345678',
      text: 'hi',
    })
    expect(r.ok).toBe(true)
    expect(r.externalMessageId).toBe('wamid.X')
  })
})

describe('messengerAdapter', () => {
  it('page_access_token 欠落は恒久失敗', async () => {
    const r = await messengerAdapter({ credentials: {}, to: 'PSID1', text: 'x' })
    expect(r).toMatchObject({ ok: false, permanent: true })
  })

  it('成功時に message_id を返す・トークンはBearerヘッダで送る(URLに載せない)', async () => {
    const fetchFn = mockFetch(() => jsonResponse(200, { recipient_id: 'PSID1', message_id: 'mid.X' }))
    const r = await messengerAdapter({
      credentials: { page_access_token: 'PAGE_TOKEN' },
      to: 'PSID1',
      text: 'hi',
    })
    expect(r.ok).toBe(true)
    expect(r.externalMessageId).toBe('mid.X')
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit]
    expect(url).not.toContain('access_token') // トークンをURLクエリに載せない
    expect(init.headers).toMatchObject({ Authorization: 'Bearer PAGE_TOKEN' })
  })
})

describe('deliverToChannel dispatch', () => {
  it('未対応チャネル(email)は恒久失敗', async () => {
    const r = await deliverToChannel('email', { credentials: {}, to: 'x', text: 'y' })
    expect(r).toMatchObject({ ok: false, permanent: true })
  })

  it('未知チャネルは恒久失敗', async () => {
    const r = await deliverToChannel('myspace', { credentials: {}, to: 'x', text: 'y' })
    expect(r).toMatchObject({ ok: false, permanent: true })
  })

  it('slack をディスパッチできる', async () => {
    mockFetch(() => jsonResponse(200, { ok: true, ts: '1' }))
    const r = await deliverToChannel('slack', { credentials: { bot_token: 'xoxb' }, to: 'C1', text: 'hi' })
    expect(r.ok).toBe(true)
  })
})
