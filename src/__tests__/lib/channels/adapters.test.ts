import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { deliverToChannel } from '@/lib/channels/adapters'
import { slackAdapter } from '@/lib/channels/adapters/slack'
import { chatworkAdapter } from '@/lib/channels/adapters/chatwork'
import { telegramAdapter } from '@/lib/channels/adapters/telegram'
import { discordAdapter } from '@/lib/channels/adapters/discord'
import { googleChatAdapter } from '@/lib/channels/adapters/googleChat'
import { teamsAdapter } from '@/lib/channels/adapters/teams'
import { whatsappAdapter } from '@/lib/channels/adapters/whatsapp'
import { isAllowedWebhookUrl } from '@/lib/channels/adapters/webhookUrl'
import { classifyStatus } from '@/lib/channels/adapters/types'

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

  it('googleChat: text ペイロードで送信', async () => {
    const fetchFn = mockFetch(() => jsonResponse(200, {}))
    const r = await googleChatAdapter({
      credentials: { webhook_url: 'https://chat.googleapis.com/v1/spaces/x/messages?key=k' },
      to: 's',
      text: '完了',
    })
    expect(r.ok).toBe(true)
    expect(JSON.parse((fetchFn.mock.calls[0][1] as RequestInit).body as string)).toEqual({ text: '完了' })
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

describe('deliverToChannel dispatch', () => {
  it('未対応チャネル(messenger)は恒久失敗', async () => {
    const r = await deliverToChannel('messenger', { credentials: {}, to: 'x', text: 'y' })
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
