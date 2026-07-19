import { describe, it, expect, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import {
  handleSlackWebhook,
  type SlackWebhookDeps,
} from '@/lib/channels/slack/webhookHandler'

const SIGNING_SECRET = 'slack-signing-secret'
const NOW = 1_700_000_100
const TS = String(NOW) // request timestamp（署名対象）

const ACCOUNT = {
  id: 'acc-sl-1',
  channel: 'slack',
  orgId: 'org-1',
  ownerType: 'org' as const,
  status: 'active' as const,
  credentials: { bot_token: 'xoxb-1', signing_secret: SIGNING_SECRET },
}

function sign(rawBody: string, timestamp = TS, secret = SIGNING_SECRET): string {
  return 'v0=' + createHmac('sha256', secret).update(`v0:${timestamp}:${rawBody}`).digest('hex')
}

function eventBody(over: Record<string, unknown> = {}) {
  return JSON.stringify({
    token: 'z',
    team_id: 'T123',
    api_app_id: 'A123',
    type: 'event_callback',
    event_id: 'Ev123',
    event_time: NOW,
    event: {
      type: 'message',
      channel: 'C123',
      user: 'U999',
      text: '見積もりまだですか',
      ts: '1700000100.000200',
      channel_type: 'channel',
      ...over,
    },
  })
}

function makeDeps(over: Partial<SlackWebhookDeps> = {}): SlackWebhookDeps {
  return {
    loadAccount: vi.fn().mockResolvedValue(ACCOUNT),
    findIdentities: vi.fn().mockResolvedValue([]),
    insertMessage: vi.fn().mockResolvedValue({ id: 'msg-1' }),
    ...over,
  }
}

function auth(rawBody: string, over: Partial<{ signature: string; timestamp: string; nowSeconds: number }> = {}) {
  const timestamp = over.timestamp ?? TS
  return {
    signature: over.signature ?? sign(rawBody, timestamp),
    timestamp,
    nowSeconds: over.nowSeconds ?? NOW,
  }
}

describe('handleSlackWebhook — 認証', () => {
  it('署名不一致は401で何も書かない', async () => {
    const deps = makeDeps()
    const body = eventBody()
    const res = await handleSlackWebhook('acc-sl-1', body, { ...auth(body), signature: 'v0=bad' }, deps)
    expect(res.status).toBe(401)
    expect(deps.insertMessage).not.toHaveBeenCalled()
  })

  it('署名/timestamp欠如は401', async () => {
    const deps = makeDeps()
    const body = eventBody()
    const res = await handleSlackWebhook('acc-sl-1', body, { signature: null, timestamp: null, nowSeconds: NOW }, deps)
    expect(res.status).toBe(401)
  })

  it('リプレイ（5分超の古いtimestamp）は401', async () => {
    const deps = makeDeps()
    const oldTs = String(NOW - 400)
    const body = eventBody()
    const res = await handleSlackWebhook('acc-sl-1', body, { signature: sign(body, oldTs), timestamp: oldTs, nowSeconds: NOW }, deps)
    expect(res.status).toBe(401)
    expect(deps.insertMessage).not.toHaveBeenCalled()
  })

  it('未知アカウントは401（存在秘匿）', async () => {
    const deps = makeDeps({ loadAccount: vi.fn().mockResolvedValue(null) })
    const body = eventBody()
    const res = await handleSlackWebhook('nope', body, auth(body), deps)
    expect(res.status).toBe(401)
  })

  it('signing_secret 未設定は401', async () => {
    const deps = makeDeps({
      loadAccount: vi.fn().mockResolvedValue({ ...ACCOUNT, credentials: { bot_token: 'x' } }),
    })
    const body = eventBody()
    const res = await handleSlackWebhook('acc-sl-1', body, auth(body), deps)
    expect(res.status).toBe(401)
  })

  it('platformアカウントは非対応(400)', async () => {
    const deps = makeDeps({
      loadAccount: vi.fn().mockResolvedValue({ ...ACCOUNT, ownerType: 'platform', orgId: null }),
    })
    const body = eventBody()
    const res = await handleSlackWebhook('acc-sl-1', body, auth(body), deps)
    expect(res.status).toBe(400)
    expect(deps.insertMessage).not.toHaveBeenCalled()
  })
})

describe('handleSlackWebhook — url_verification', () => {
  it('署名一致の url_verification は challenge を返し記録しない', async () => {
    const deps = makeDeps()
    const body = JSON.stringify({ type: 'url_verification', challenge: 'CH4L' })
    const res = await handleSlackWebhook('acc-sl-1', body, auth(body), deps)
    expect(res.status).toBe(200)
    expect(res.body.challenge).toBe('CH4L')
    expect(deps.insertMessage).not.toHaveBeenCalled()
  })

  it('署名不一致の url_verification は401（未検証で challenge を返さない）', async () => {
    const deps = makeDeps()
    const body = JSON.stringify({ type: 'url_verification', challenge: 'CH4L' })
    const res = await handleSlackWebhook('acc-sl-1', body, { ...auth(body), signature: 'v0=bad' }, deps)
    expect(res.status).toBe(401)
    expect(res.body.challenge).toBeUndefined()
  })
})

describe('handleSlackWebhook — メッセージ取り込み', () => {
  it('正当な message: identity 0件は triage(null) 記録で200', async () => {
    const deps = makeDeps()
    const body = eventBody()
    const res = await handleSlackWebhook('acc-sl-1', body, auth(body), deps)
    expect(res.status).toBe(200)
    expect(deps.insertMessage).toHaveBeenCalledTimes(1)
    const arg = (deps.insertMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(arg).toMatchObject({
      orgId: 'org-1',
      channel: 'slack',
      direction: 'inbound',
      actor: 'client',
      spaceId: null,
      identityId: null,
      externalUserId: 'U999',
      body: '見積もりまだですか',
      accountId: 'acc-sl-1',
      contentType: 'text',
    })
    // dedupe キーは channel:ts（ch内でtsは一意・再送で不変）
    expect(arg.externalMessageId).toBe('C123:1700000100.000200')
  })

  it('identity 1件で space/identity 確定・突合は(org, user)で行う', async () => {
    const deps = makeDeps({
      findIdentities: vi.fn().mockResolvedValue([{ id: 'idn-1', spaceId: 'space-1' }]),
    })
    const body = eventBody()
    await handleSlackWebhook('acc-sl-1', body, auth(body), deps)
    const arg = (deps.insertMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(arg).toMatchObject({ spaceId: 'space-1', identityId: 'idn-1' })
    expect((deps.findIdentities as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual(['org-1', 'U999'])
  })

  it('bot自身の発言(bot_id)はループ防止で無視', async () => {
    const deps = makeDeps()
    const body = eventBody({ bot_id: 'B123', user: undefined })
    const res = await handleSlackWebhook('acc-sl-1', body, auth(body), deps)
    expect(res.status).toBe(200)
    expect(deps.insertMessage).not.toHaveBeenCalled()
  })

  it('subtype付き(message_changed/bot_message等)は無視', async () => {
    const deps = makeDeps()
    const body = eventBody({ subtype: 'message_changed' })
    const res = await handleSlackWebhook('acc-sl-1', body, auth(body), deps)
    expect(res.status).toBe(200)
    expect(deps.insertMessage).not.toHaveBeenCalled()
  })

  it('message以外のイベント(reaction_added等)は無視', async () => {
    const deps = makeDeps()
    const body = eventBody({ type: 'reaction_added' })
    const res = await handleSlackWebhook('acc-sl-1', body, auth(body), deps)
    expect(res.status).toBe(200)
    expect(deps.insertMessage).not.toHaveBeenCalled()
  })

  it('Slackリトライ(x-slack-retry)でもdedupで冪等に処理（duplicateでも200）', async () => {
    const deps = makeDeps({ insertMessage: vi.fn().mockResolvedValue('duplicate') })
    const body = eventBody()
    const res = await handleSlackWebhook('acc-sl-1', body, auth(body), deps)
    expect(res.status).toBe(200)
  })

  it('不正JSONは200（再送ループ回避）で記録しない', async () => {
    const deps = makeDeps()
    const res = await handleSlackWebhook('acc-sl-1', '{bad', auth('{bad'), deps)
    expect(res.status).toBe(200)
    expect(deps.insertMessage).not.toHaveBeenCalled()
  })
})
