import { describe, it, expect, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import {
  handleChatworkWebhook,
  type ChatworkWebhookDeps,
} from '@/lib/channels/chatwork/webhookHandler'

// Chatwork Webhook v2 の webhook_token は base64 で配布される。
// 署名 = base64( HMAC-SHA256( rawBody, base64decode(webhook_token) ) )
const WEBHOOK_TOKEN = Buffer.from('chatwork-secret-key').toString('base64')

const ACCOUNT = {
  id: 'acc-cw-1',
  channel: 'chatwork',
  orgId: 'org-1',
  ownerType: 'org' as const,
  status: 'active' as const,
  credentials: { api_token: 'tok', webhook_token: WEBHOOK_TOKEN },
}

function sign(rawBody: string, token = WEBHOOK_TOKEN): string {
  return createHmac('sha256', Buffer.from(token, 'base64')).update(rawBody, 'utf8').digest('base64')
}

function messageEvent(over: Record<string, unknown> = {}, type = 'message_created') {
  return JSON.stringify({
    webhook_setting_id: '99',
    webhook_event_type: type,
    webhook_event_time: 1_700_000_000,
    webhook_event: {
      message_id: '1234567890',
      room_id: 108480917,
      account_id: 363,
      body: 'テスト依頼です',
      send_time: 1_700_000_000,
      update_time: 0,
      ...over,
    },
  })
}

function makeDeps(over: Partial<ChatworkWebhookDeps> = {}): ChatworkWebhookDeps {
  return {
    loadAccount: vi.fn().mockResolvedValue(ACCOUNT),
    findIdentities: vi.fn().mockResolvedValue([]),
    insertMessage: vi.fn().mockResolvedValue({ id: 'msg-1' }),
    ...over,
  }
}

describe('handleChatworkWebhook', () => {
  it('署名不一致は401で何も書かない', async () => {
    const deps = makeDeps()
    const body = messageEvent()
    const res = await handleChatworkWebhook('acc-cw-1', body, 'AAAAwrongAAAA', deps)
    expect(res.status).toBe(401)
    expect(deps.insertMessage).not.toHaveBeenCalled()
  })

  it('署名ヘッダ欠如は401', async () => {
    const deps = makeDeps()
    const res = await handleChatworkWebhook('acc-cw-1', messageEvent(), null, deps)
    expect(res.status).toBe(401)
    expect(deps.insertMessage).not.toHaveBeenCalled()
  })

  it('未知アカウントは401（存在秘匿・記録しない）', async () => {
    const deps = makeDeps({ loadAccount: vi.fn().mockResolvedValue(null) })
    const body = messageEvent()
    const res = await handleChatworkWebhook('nope', body, sign(body), deps)
    expect(res.status).toBe(401)
    expect(deps.insertMessage).not.toHaveBeenCalled()
  })

  it('webhook_token 未設定のアカウントは401（検証不能）', async () => {
    const deps = makeDeps({
      loadAccount: vi.fn().mockResolvedValue({
        ...ACCOUNT,
        credentials: { api_token: 'tok' },
      }),
    })
    const body = messageEvent()
    const res = await handleChatworkWebhook('acc-cw-1', body, sign(body), deps)
    expect(res.status).toBe(401)
    expect(deps.insertMessage).not.toHaveBeenCalled()
  })

  it('platformアカウントは非対応(400)。org解決不能なため記録しない', async () => {
    const deps = makeDeps({
      loadAccount: vi.fn().mockResolvedValue({ ...ACCOUNT, ownerType: 'platform', orgId: null }),
    })
    const body = messageEvent()
    const res = await handleChatworkWebhook('acc-cw-1', body, sign(body), deps)
    expect(res.status).toBe(400)
    expect(deps.insertMessage).not.toHaveBeenCalled()
  })

  it('正当な message_created: identity 0件は triage(null) 記録で200', async () => {
    const deps = makeDeps()
    const body = messageEvent()
    const res = await handleChatworkWebhook('acc-cw-1', body, sign(body), deps)
    expect(res.status).toBe(200)
    expect(deps.insertMessage).toHaveBeenCalledTimes(1)
    const arg = (deps.insertMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(arg).toMatchObject({
      orgId: 'org-1',
      channel: 'chatwork',
      direction: 'inbound',
      actor: 'client',
      spaceId: null,
      identityId: null,
      externalUserId: '363',
      body: 'テスト依頼です',
      accountId: 'acc-cw-1',
      contentType: 'text',
    })
    // dedupe キーは room_id:message_id（再送で不変・room内で一意）
    expect(arg.externalMessageId).toBe('108480917:1234567890')
  })

  it('identity がちょうど1件なら space/identity を確定', async () => {
    const deps = makeDeps({
      findIdentities: vi.fn().mockResolvedValue([{ id: 'idn-1', spaceId: 'space-1' }]),
    })
    const body = messageEvent()
    await handleChatworkWebhook('acc-cw-1', body, sign(body), deps)
    const arg = (deps.insertMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(arg).toMatchObject({ spaceId: 'space-1', identityId: 'idn-1' })
    // 突合は (org, chatwork, account_id) で行う
    const findArg = (deps.findIdentities as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(findArg).toEqual(['org-1', '363'])
  })

  it('identity が複数なら人力トリアージ（null記録）', async () => {
    const deps = makeDeps({
      findIdentities: vi
        .fn()
        .mockResolvedValue([{ id: 'a', spaceId: 's1' }, { id: 'b', spaceId: 's2' }]),
    })
    const body = messageEvent()
    await handleChatworkWebhook('acc-cw-1', body, sign(body), deps)
    const arg = (deps.insertMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(arg).toMatchObject({ spaceId: null, identityId: null })
  })

  it('mention_to_me も取り込む', async () => {
    const deps = makeDeps()
    const body = messageEvent({}, 'mention_to_me')
    const res = await handleChatworkWebhook('acc-cw-1', body, sign(body), deps)
    expect(res.status).toBe(200)
    expect(deps.insertMessage).toHaveBeenCalledTimes(1)
  })

  it('メッセージ以外のイベント(message_deleted等)は200 ignoredで記録しない', async () => {
    const deps = makeDeps()
    const body = JSON.stringify({
      webhook_event_type: 'message_deleted',
      webhook_event: { message_id: '1', room_id: 1, account_id: 2 },
    })
    const res = await handleChatworkWebhook('acc-cw-1', body, sign(body), deps)
    expect(res.status).toBe(200)
    expect(deps.insertMessage).not.toHaveBeenCalled()
  })

  it('bot自身の発言(account_id一致)はループ防止で無視', async () => {
    const deps = makeDeps({
      loadAccount: vi.fn().mockResolvedValue({
        ...ACCOUNT,
        credentials: { ...ACCOUNT.credentials, bot_account_id: '363' },
      }),
    })
    const body = messageEvent({ account_id: 363 })
    const res = await handleChatworkWebhook('acc-cw-1', body, sign(body), deps)
    expect(res.status).toBe(200)
    expect(deps.insertMessage).not.toHaveBeenCalled()
  })

  it('不正JSONは200（再送ループ回避）で記録しない', async () => {
    const deps = makeDeps()
    // 署名は生ボディに対して検証するので、壊れたJSONでも署名は一致させる
    const res = await handleChatworkWebhook('acc-cw-1', '{bad', sign('{bad'), deps)
    expect(res.status).toBe(200)
    expect(deps.insertMessage).not.toHaveBeenCalled()
  })

  it('重複(insertMessageがduplicate)でも200', async () => {
    const deps = makeDeps({ insertMessage: vi.fn().mockResolvedValue('duplicate') })
    const body = messageEvent()
    const res = await handleChatworkWebhook('acc-cw-1', body, sign(body), deps)
    expect(res.status).toBe(200)
  })
})
