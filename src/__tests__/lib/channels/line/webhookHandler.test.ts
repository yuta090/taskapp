import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'node:crypto'

/**
 * LINE webhook オーケストレーション
 *
 * 順序厳守: 未検証ボディは destination 抽出以外に使わない
 *   1. destination だけ取り出す → 2. アカウント逆引き → 3. 署名検証 → 4. イベント処理
 *
 * - 署名不正 → 401（何も書かない）
 * - 不明 destination → 200 ignored（LINE再送ループ防止のため常に200系）
 * - テキスト: active identity 1件なら space/identity を確定、0件/複数はnullで記録（人力トリアージ）
 * - リンクコード: 突合成立 → identity作成＋確認メッセージ返信。他orgのコードは無効
 * - follow: system記録＋挨拶（AI名乗り・記録明示の固定文言）
 * - 添付: 受信時にコンテンツ取得→Storage保存（LINE側は期限で消えるため）
 * - dedupe: 同一 message.id の再送では二重記録しない
 */

const CHANNEL_SECRET = 'secret-abc'
const ACCOUNT = {
  id: 'acc-1',
  orgId: 'org-1',
  displayName: '山田会計事務所',
  channelSecret: CHANNEL_SECRET,
  accessToken: 'token-xyz',
}

const storeMock = {
  findLineAccountByDestination: vi.fn(),
  findActiveLineIdentities: vi.fn(),
  insertChannelMessage: vi.fn(),
  findValidLinkCode: vi.fn(),
  linkIdentityViaCode: vi.fn(),
  uploadAttachment: vi.fn(),
}
vi.mock('@/lib/channels/store', () => storeMock)

const pushMock = vi.fn()
const fetchContentMock = vi.fn()
vi.mock('@/lib/channels/line/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/channels/line/client')>()
  return {
    ...actual,
    pushLineMessage: (...args: unknown[]) => pushMock(...args),
    fetchLineMessageContent: (...args: unknown[]) => fetchContentMock(...args),
  }
})

const { handleLineWebhook } = await import('@/lib/channels/line/webhookHandler')

function sign(body: string, secret: string = CHANNEL_SECRET): string {
  return createHmac('sha256', secret).update(body).digest('base64')
}

function makeBody(events: Record<string, unknown>[]): string {
  return JSON.stringify({ destination: 'Ubot-1', events })
}

function textEvent(text: string, overrides: Record<string, unknown> = {}) {
  return {
    type: 'message',
    webhookEventId: 'evt-1',
    deliveryContext: { isRedelivery: false },
    timestamp: 1750000000000,
    mode: 'active',
    source: { type: 'user', userId: 'U-client-1' },
    replyToken: 'rt-1',
    message: { id: 'msg-1', type: 'text', text },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  storeMock.findLineAccountByDestination.mockResolvedValue(ACCOUNT)
  storeMock.findActiveLineIdentities.mockResolvedValue([])
  storeMock.insertChannelMessage.mockResolvedValue({ id: 'row-1' })
  storeMock.findValidLinkCode.mockResolvedValue(null)
  pushMock.mockResolvedValue(undefined)
})

describe('handleLineWebhook', () => {
  it('署名不正なら401で何も書かない', async () => {
    const body = makeBody([textEvent('こんにちは')])
    const result = await handleLineWebhook(body, sign(body, 'wrong-secret'))

    expect(result.status).toBe(401)
    expect(storeMock.insertChannelMessage).not.toHaveBeenCalled()
  })

  it('署名ヘッダ欠落も401', async () => {
    const body = makeBody([textEvent('x')])
    const result = await handleLineWebhook(body, null)
    expect(result.status).toBe(401)
  })

  it('不明destinationは200 ignored（署名検証不能でも再送ループを作らない）', async () => {
    storeMock.findLineAccountByDestination.mockResolvedValue(null)
    const body = makeBody([textEvent('x')])
    const result = await handleLineWebhook(body, sign(body))

    expect(result.status).toBe(200)
    expect(storeMock.insertChannelMessage).not.toHaveBeenCalled()
  })

  it('JSONでないボディは200 ignored', async () => {
    const result = await handleLineWebhook('not json', 'sig')
    expect(result.status).toBe(200)
    expect(storeMock.insertChannelMessage).not.toHaveBeenCalled()
  })

  it('テキスト: identityが1件なら space/identity を確定して記録', async () => {
    storeMock.findActiveLineIdentities.mockResolvedValue([{ id: 'ident-1', spaceId: 'space-1' }])
    const body = makeBody([textEvent('請求書を送ります')])
    const result = await handleLineWebhook(body, sign(body))

    expect(result.status).toBe(200)
    expect(storeMock.insertChannelMessage).toHaveBeenCalledTimes(1)
    expect(storeMock.insertChannelMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        spaceId: 'space-1',
        identityId: 'ident-1',
        accountId: 'acc-1',
        channel: 'line',
        direction: 'inbound',
        actor: 'client',
        externalUserId: 'U-client-1',
        externalMessageId: 'msg-1',
        contentType: 'text',
        body: '請求書を送ります',
      }),
    )
  })

  it('identityが複数件（同一人物が複数顧問先の窓口）なら space/identity はnullで記録', async () => {
    storeMock.findActiveLineIdentities.mockResolvedValue([
      { id: 'ident-1', spaceId: 'space-1' },
      { id: 'ident-2', spaceId: 'space-2' },
    ])
    const body = makeBody([textEvent('よろしく')])
    await handleLineWebhook(body, sign(body))

    expect(storeMock.insertChannelMessage).toHaveBeenCalledWith(
      expect.objectContaining({ spaceId: null, identityId: null }),
    )
  })

  it('dedupe: 重複はスキップして200', async () => {
    storeMock.insertChannelMessage.mockResolvedValue('duplicate')
    const body = makeBody([textEvent('再送')])
    const result = await handleLineWebhook(body, sign(body))

    expect(result.status).toBe(200)
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('リンクコード: 突合成立 → identity作成＋確認返信＋往復とも記録', async () => {
    storeMock.findValidLinkCode.mockResolvedValue({
      id: 'code-1',
      orgId: 'org-1',
      spaceId: 'space-9',
      firstUsedAt: null,
    })
    storeMock.linkIdentityViaCode.mockResolvedValue({ id: 'ident-9', spaceId: 'space-9' })

    const body = makeBody([textEvent('AB2CD3EF')])
    const result = await handleLineWebhook(body, sign(body))

    expect(result.status).toBe(200)
    expect(storeMock.findValidLinkCode).toHaveBeenCalledWith('AB2CD3EF')
    expect(storeMock.linkIdentityViaCode).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'code-1' }),
      'U-client-1',
    )
    // inbound(コード) と outbound(確認) の2件
    const directions = storeMock.insertChannelMessage.mock.calls.map(
      (c) => (c[0] as { direction: string }).direction,
    )
    expect(directions).toEqual(['inbound', 'outbound'])
    // inbound はコード成立した identity に帰属
    expect(storeMock.insertChannelMessage.mock.calls[0][0]).toMatchObject({
      identityId: 'ident-9',
      spaceId: 'space-9',
    })
    expect(pushMock).toHaveBeenCalledTimes(1)
  })

  it('他orgのリンクコードは成立しない', async () => {
    storeMock.findValidLinkCode.mockResolvedValue({
      id: 'code-x',
      orgId: 'org-OTHER',
      spaceId: 'space-x',
      firstUsedAt: null,
    })
    const body = makeBody([textEvent('AB2CD3EF')])
    await handleLineWebhook(body, sign(body))

    expect(storeMock.linkIdentityViaCode).not.toHaveBeenCalled()
  })

  it('follow: system記録＋挨拶（AI名乗り・記録明示）を返信', async () => {
    const body = makeBody([
      {
        type: 'follow',
        webhookEventId: 'evt-follow',
        deliveryContext: { isRedelivery: false },
        timestamp: 1750000000000,
        mode: 'active',
        source: { type: 'user', userId: 'U-client-1' },
        replyToken: 'rt-2',
      },
    ])
    const result = await handleLineWebhook(body, sign(body))

    expect(result.status).toBe(200)
    expect(pushMock).toHaveBeenCalledTimes(1)
    const pushArg = pushMock.mock.calls[0][0] as {
      to: string
      messages: { text: string }[]
    }
    expect(pushArg.to).toBe('U-client-1')
    const greeting = pushArg.messages[0].text
    expect(greeting).toContain('山田会計事務所')
    expect(greeting).toContain('AI')
    expect(greeting).toContain('記録に残ります')
  })

  it('画像: コンテンツを取得してStorage保存し storagePath 付きで記録', async () => {
    storeMock.findActiveLineIdentities.mockResolvedValue([{ id: 'ident-1', spaceId: 'space-1' }])
    fetchContentMock.mockResolvedValue({
      data: new ArrayBuffer(8),
      contentType: 'image/jpeg',
    })
    storeMock.uploadAttachment.mockResolvedValue('org-1/line/msg-img-1')

    const body = makeBody([
      textEvent('', {
        message: { id: 'msg-img-1', type: 'image', contentProvider: { type: 'line' } },
      }),
    ])
    const result = await handleLineWebhook(body, sign(body))

    expect(result.status).toBe(200)
    expect(fetchContentMock).toHaveBeenCalledWith('token-xyz', 'msg-img-1')
    expect(storeMock.uploadAttachment).toHaveBeenCalled()
    expect(storeMock.insertChannelMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        contentType: 'image',
        storagePath: 'org-1/line/msg-img-1',
        status: 'received',
      }),
    )
  })

  it('画像: コンテンツ取得失敗でも status=failed で記録し200（後からリトライ可能）', async () => {
    fetchContentMock.mockRejectedValue(new Error('content expired'))
    const body = makeBody([
      textEvent('', {
        message: { id: 'msg-img-2', type: 'image', contentProvider: { type: 'line' } },
      }),
    ])
    const result = await handleLineWebhook(body, sign(body))

    expect(result.status).toBe(200)
    expect(storeMock.insertChannelMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        contentType: 'image',
        storagePath: null,
        status: 'failed',
        error: expect.stringContaining('content expired'),
      }),
    )
  })

  it('1イベントの処理失敗が他イベントを巻き込まない', async () => {
    storeMock.insertChannelMessage
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce({ id: 'row-2' })

    const body = makeBody([
      textEvent('1通目', { message: { id: 'm1', type: 'text', text: '1通目' } }),
      textEvent('2通目', { webhookEventId: 'evt-2', message: { id: 'm2', type: 'text', text: '2通目' } }),
    ])
    const result = await handleLineWebhook(body, sign(body))

    expect(result.status).toBe(200)
    expect(storeMock.insertChannelMessage).toHaveBeenCalledTimes(2)
  })
})
