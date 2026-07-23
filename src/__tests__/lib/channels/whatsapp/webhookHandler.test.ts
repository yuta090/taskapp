import { describe, it, expect, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import {
  handleWhatsappWebhook,
  verifyWhatsappSubscription,
  WHATSAPP_LINK_CONFIRMED_TEXT,
  WHATSAPP_LINK_FAILED_TEXT,
  type WhatsappWebhookDeps,
  type WhatsappValidLinkCode,
} from '@/lib/channels/whatsapp/webhookHandler'
import { generateUserLinkCode } from '@/lib/channels/userLink'

const APP_SECRET = 'meta-app-secret'
const VERIFY_TOKEN = 'whsec_verify_abc'

const ACCOUNT = {
  id: 'acc-wa-1',
  channel: 'whatsapp',
  orgId: 'org-1',
  ownerType: 'org' as const,
  status: 'active' as const,
  credentials: {
    access_token: 'EAAt',
    phone_number_id: '10055500001',
    app_secret: APP_SECRET,
    verify_token: VERIFY_TOKEN,
  },
}

function sign(rawBody: string, secret = APP_SECRET): string {
  return 'sha256=' + createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
}

function messagePayload(over: Record<string, unknown> = {}) {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA_ID',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: '10055500001', display_phone_number: '815000' },
              contacts: [{ wa_id: '819012345678', profile: { name: '田中' } }],
              messages: [
                {
                  from: '819012345678',
                  id: 'wamid.ABC123',
                  timestamp: '1700000000',
                  type: 'text',
                  text: { body: '見積もりお願いします' },
                },
              ],
              ...over,
            },
          },
        ],
      },
    ],
  })
}

function makeDeps(over: Partial<WhatsappWebhookDeps> = {}): WhatsappWebhookDeps {
  return {
    loadAccount: vi.fn().mockResolvedValue(ACCOUNT),
    findIdentities: vi.fn().mockResolvedValue([]),
    insertMessage: vi.fn().mockResolvedValue({ id: 'msg-1' }),
    ...over,
  }
}

describe('verifyWhatsappSubscription (GET handshake)', () => {
  it('verify_token 一致で challenge をそのまま返す(200)', async () => {
    const deps = makeDeps()
    const res = await verifyWhatsappSubscription('acc-wa-1', 'subscribe', VERIFY_TOKEN, 'CH4LL', deps)
    expect(res.status).toBe(200)
    expect(res.body).toBe('CH4LL')
  })

  it('verify_token 不一致は403', async () => {
    const deps = makeDeps()
    const res = await verifyWhatsappSubscription('acc-wa-1', 'subscribe', 'WRONG', 'CH4LL', deps)
    expect(res.status).toBe(403)
  })

  it('mode が subscribe でないと403', async () => {
    const deps = makeDeps()
    const res = await verifyWhatsappSubscription('acc-wa-1', 'unsubscribe', VERIFY_TOKEN, 'CH4LL', deps)
    expect(res.status).toBe(403)
  })

  it('未知アカウントは403', async () => {
    const deps = makeDeps({ loadAccount: vi.fn().mockResolvedValue(null) })
    const res = await verifyWhatsappSubscription('nope', 'subscribe', VERIFY_TOKEN, 'CH4LL', deps)
    expect(res.status).toBe(403)
  })

  it('verify_token 未設定アカウントは403', async () => {
    const deps = makeDeps({
      loadAccount: vi.fn().mockResolvedValue({ ...ACCOUNT, credentials: { app_secret: APP_SECRET } }),
    })
    const res = await verifyWhatsappSubscription('acc-wa-1', 'subscribe', VERIFY_TOKEN, 'CH4LL', deps)
    expect(res.status).toBe(403)
  })
})

describe('handleWhatsappWebhook (POST ingest)', () => {
  it('署名不一致は401で何も書かない', async () => {
    const deps = makeDeps()
    const body = messagePayload()
    const res = await handleWhatsappWebhook('acc-wa-1', body, 'sha256=deadbeef', deps)
    expect(res.status).toBe(401)
    expect(deps.insertMessage).not.toHaveBeenCalled()
  })

  it('署名ヘッダ欠如は401', async () => {
    const deps = makeDeps()
    const res = await handleWhatsappWebhook('acc-wa-1', messagePayload(), null, deps)
    expect(res.status).toBe(401)
  })

  it('app_secret 未設定アカウントは401（検証不能）', async () => {
    const deps = makeDeps({
      loadAccount: vi.fn().mockResolvedValue({
        ...ACCOUNT,
        credentials: { access_token: 'x', phone_number_id: '1', verify_token: VERIFY_TOKEN },
      }),
    })
    const body = messagePayload()
    const res = await handleWhatsappWebhook('acc-wa-1', body, sign(body), deps)
    expect(res.status).toBe(401)
    expect(deps.insertMessage).not.toHaveBeenCalled()
  })

  it('未知アカウントは401', async () => {
    const deps = makeDeps({ loadAccount: vi.fn().mockResolvedValue(null) })
    const body = messagePayload()
    const res = await handleWhatsappWebhook('nope', body, sign(body), deps)
    expect(res.status).toBe(401)
  })

  it('platformアカウントは非対応(400)', async () => {
    const deps = makeDeps({
      loadAccount: vi.fn().mockResolvedValue({ ...ACCOUNT, ownerType: 'platform', orgId: null }),
    })
    const body = messagePayload()
    const res = await handleWhatsappWebhook('acc-wa-1', body, sign(body), deps)
    expect(res.status).toBe(400)
    expect(deps.insertMessage).not.toHaveBeenCalled()
  })

  it('正当な text 受信: identity 0件は triage(null) 記録で200', async () => {
    const deps = makeDeps()
    const body = messagePayload()
    const res = await handleWhatsappWebhook('acc-wa-1', body, sign(body), deps)
    expect(res.status).toBe(200)
    expect(deps.insertMessage).toHaveBeenCalledTimes(1)
    const arg = (deps.insertMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(arg).toMatchObject({
      orgId: 'org-1',
      channel: 'whatsapp',
      direction: 'inbound',
      actor: 'client',
      spaceId: null,
      identityId: null,
      externalUserId: '819012345678',
      body: '見積もりお願いします',
      accountId: 'acc-wa-1',
      contentType: 'text',
    })
    // dedupe キーは wamid（グローバル一意）
    expect(arg.externalMessageId).toBe('wamid.ABC123')
  })

  it('identity 1件で space/identity 確定・突合は(org, from)で行う', async () => {
    const deps = makeDeps({
      findIdentities: vi.fn().mockResolvedValue([{ id: 'idn-1', spaceId: 'space-1' }]),
    })
    const body = messagePayload()
    await handleWhatsappWebhook('acc-wa-1', body, sign(body), deps)
    const arg = (deps.insertMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(arg).toMatchObject({ spaceId: 'space-1', identityId: 'idn-1' })
    expect((deps.findIdentities as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual([
      'org-1',
      '819012345678',
    ])
  })

  it('複数メッセージは各々取り込む', async () => {
    const deps = makeDeps()
    const body = messagePayload({
      messages: [
        { from: '81901', id: 'wamid.1', timestamp: '1700000000', type: 'text', text: { body: 'A' } },
        { from: '81902', id: 'wamid.2', timestamp: '1700000001', type: 'text', text: { body: 'B' } },
      ],
    })
    const res = await handleWhatsappWebhook('acc-wa-1', body, sign(body), deps)
    expect(res.status).toBe(200)
    expect(deps.insertMessage).toHaveBeenCalledTimes(2)
  })

  it('statuses(配信レシート)のみのペイロードは記録せず200', async () => {
    const deps = makeDeps()
    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: '10055500001' },
                statuses: [{ id: 'wamid.x', status: 'delivered' }],
              },
            },
          ],
        },
      ],
    })
    const res = await handleWhatsappWebhook('acc-wa-1', body, sign(body), deps)
    expect(res.status).toBe(200)
    expect(deps.insertMessage).not.toHaveBeenCalled()
  })

  it('非テキスト(image等)は無視して200', async () => {
    const deps = makeDeps()
    const body = messagePayload({
      messages: [
        { from: '81901', id: 'wamid.img', timestamp: '1700000000', type: 'image', image: { id: 'x' } },
      ],
    })
    const res = await handleWhatsappWebhook('acc-wa-1', body, sign(body), deps)
    expect(res.status).toBe(200)
    expect(deps.insertMessage).not.toHaveBeenCalled()
  })

  it('不正JSONは200（再送ループ回避）で記録しない', async () => {
    const deps = makeDeps()
    const res = await handleWhatsappWebhook('acc-wa-1', '{bad', sign('{bad'), deps)
    expect(res.status).toBe(200)
    expect(deps.insertMessage).not.toHaveBeenCalled()
  })

  it('重複(duplicate)でも200', async () => {
    const deps = makeDeps({ insertMessage: vi.fn().mockResolvedValue('duplicate') })
    const body = messagePayload()
    const res = await handleWhatsappWebhook('acc-wa-1', body, sign(body), deps)
    expect(res.status).toBe(200)
  })
})

describe('handleWhatsappWebhook: DM紐付け床（突合コード償還）', () => {
  const LINK_CODE: WhatsappValidLinkCode = {
    id: 'lc-1',
    orgId: 'org-1',
    spaceId: 'space-1',
    firstUsedAt: null,
  }

  function linkCodePayload(text: string) {
    return messagePayload({
      messages: [
        {
          from: '819012345678',
          id: 'wamid.LINK1',
          timestamp: '1700000000',
          type: 'text',
          text: { body: text },
        },
      ],
    })
  }

  it('正orgの有効コード: linkIdentity呼び出し・spaceId/identityId付きで記録・確認返信1回', async () => {
    const sendReply = vi.fn().mockResolvedValue(undefined)
    const linkIdentity = vi.fn().mockResolvedValue({ id: 'idn-1', spaceId: 'space-1' })
    const deps = makeDeps({
      findLinkCode: vi.fn().mockResolvedValue(LINK_CODE),
      linkIdentity,
      sendReply,
    })
    const body = linkCodePayload('ABCDEFGH')
    const res = await handleWhatsappWebhook('acc-wa-1', body, sign(body), deps)

    expect(res.status).toBe(200)
    expect(linkIdentity).toHaveBeenCalledWith(LINK_CODE, '819012345678')
    const arg = (deps.insertMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(arg).toMatchObject({ spaceId: 'space-1', identityId: 'idn-1', body: 'ABCDEFGH' })
    expect(sendReply).toHaveBeenCalledTimes(1)
    expect(sendReply).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'acc-wa-1' }),
      '819012345678',
      WHATSAPP_LINK_CONFIRMED_TEXT,
    )
  })

  it('他orgのコード: 紐付けせずspace=null記録・確認返信なし（越境拒否）', async () => {
    const sendReply = vi.fn().mockResolvedValue(undefined)
    const linkIdentity = vi.fn()
    const deps = makeDeps({
      findLinkCode: vi.fn().mockResolvedValue({ ...LINK_CODE, orgId: 'org-OTHER' }),
      linkIdentity,
      sendReply,
    })
    const body = linkCodePayload('ABCDEFGH')
    const res = await handleWhatsappWebhook('acc-wa-1', body, sign(body), deps)

    expect(res.status).toBe(200)
    expect(linkIdentity).not.toHaveBeenCalled()
    const arg = (deps.insertMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(arg).toMatchObject({ spaceId: null, identityId: null })
    expect(sendReply).not.toHaveBeenCalled()
  })

  it('無効コード(見つからない) × 未突合ユーザー(identity 0件): 案内文を1回返す', async () => {
    const sendReply = vi.fn().mockResolvedValue(undefined)
    const deps = makeDeps({
      findLinkCode: vi.fn().mockResolvedValue(null),
      findIdentities: vi.fn().mockResolvedValue([]),
      sendReply,
    })
    const body = linkCodePayload('ABCDEFGH')
    const res = await handleWhatsappWebhook('acc-wa-1', body, sign(body), deps)

    expect(res.status).toBe(200)
    const arg = (deps.insertMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(arg).toMatchObject({ spaceId: null, identityId: null })
    expect(sendReply).toHaveBeenCalledTimes(1)
    expect(sendReply).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'acc-wa-1' }),
      '819012345678',
      WHATSAPP_LINK_FAILED_TEXT,
    )
  })

  it('既存identity 1件のユーザー: コード処理に入らず通常帰属（フォールスルー・返信なし）', async () => {
    const sendReply = vi.fn().mockResolvedValue(undefined)
    const linkIdentity = vi.fn()
    const deps = makeDeps({
      findLinkCode: vi.fn().mockResolvedValue(null),
      findIdentities: vi.fn().mockResolvedValue([{ id: 'idn-existing', spaceId: 'space-existing' }]),
      linkIdentity,
      sendReply,
    })
    const body = linkCodePayload('ABCDEFGH')
    const res = await handleWhatsappWebhook('acc-wa-1', body, sign(body), deps)

    expect(res.status).toBe(200)
    expect(linkIdentity).not.toHaveBeenCalled()
    const arg = (deps.insertMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(arg).toMatchObject({ spaceId: 'space-existing', identityId: 'idn-existing', body: 'ABCDEFGH' })
    expect(sendReply).not.toHaveBeenCalled()
  })

  it('内部TA-コード: 本文をマスクして記録・identity付与なし・expireLeakedUserCode呼び出し', async () => {
    const code = generateUserLinkCode()
    const expireLeakedUserCode = vi.fn().mockResolvedValue(undefined)
    const sendReply = vi.fn().mockResolvedValue(undefined)
    const deps = makeDeps({
      findLinkCode: vi.fn(),
      expireLeakedUserCode,
      sendReply,
    })
    const body = linkCodePayload(`このコードです ${code} よろしく`)
    const res = await handleWhatsappWebhook('acc-wa-1', body, sign(body), deps)

    expect(res.status).toBe(200)
    expect(expireLeakedUserCode).toHaveBeenCalledWith(`このコードです ${code} よろしく`)
    const arg = (deps.insertMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(arg).toMatchObject({ spaceId: null, identityId: null, body: '[認証コード]' })
    expect(sendReply).not.toHaveBeenCalled()
    expect((deps.findLinkCode as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
  })

  it('dedupe(同一wamid=duplicate)は確認返信を再送しない', async () => {
    const sendReply = vi.fn().mockResolvedValue(undefined)
    const linkIdentity = vi.fn().mockResolvedValue({ id: 'idn-1', spaceId: 'space-1' })
    const deps = makeDeps({
      findLinkCode: vi.fn().mockResolvedValue(LINK_CODE),
      linkIdentity,
      sendReply,
      insertMessage: vi.fn().mockResolvedValue('duplicate'),
    })
    const body = linkCodePayload('ABCDEFGH')
    const res = await handleWhatsappWebhook('acc-wa-1', body, sign(body), deps)

    expect(res.status).toBe(200)
    expect(linkIdentity).toHaveBeenCalledTimes(1)
    expect(sendReply).not.toHaveBeenCalled()
  })

  it('未紐付けの通常テキスト（コード形状ですらない）は沈黙: space=null記録・返信なし', async () => {
    const sendReply = vi.fn().mockResolvedValue(undefined)
    const findLinkCode = vi.fn()
    const deps = makeDeps({ findLinkCode, sendReply })
    const body = messagePayload() // '見積もりお願いします'
    const res = await handleWhatsappWebhook('acc-wa-1', body, sign(body), deps)

    expect(res.status).toBe(200)
    expect(findLinkCode).not.toHaveBeenCalled()
    const arg = (deps.insertMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(arg).toMatchObject({ spaceId: null, identityId: null })
    expect(sendReply).not.toHaveBeenCalled()
  })
})
