import { describe, it, expect } from 'vitest'
import { parseLineWebhookBody, normalizeLineEvent } from '@/lib/channels/line/events'

/**
 * LINE webhook イベントの正規化
 *
 * - body から destination(=bot userId) と events を取り出す
 * - message イベント → inbound メッセージレコード（text はbody、画像/ファイルはcontent参照のみ）
 * - follow / unfollow → system レコード
 * - 対応外イベントは null（無視して200を返すため）
 */

const BASE = {
  webhookEventId: '01FZ74A0TDDAYD9ZE83E79XM64',
  deliveryContext: { isRedelivery: false },
  timestamp: 1750000000000,
  mode: 'active',
  source: { type: 'user', userId: 'U4af4980629' },
}

describe('parseLineWebhookBody', () => {
  it('destination と events を取り出す', () => {
    const parsed = parseLineWebhookBody(
      JSON.stringify({ destination: 'Ubot123', events: [{ ...BASE, type: 'follow' }] }),
    )
    expect(parsed).not.toBeNull()
    expect(parsed!.destination).toBe('Ubot123')
    expect(parsed!.events).toHaveLength(1)
  })

  it('JSONでない・destination欠落は null', () => {
    expect(parseLineWebhookBody('not json')).toBeNull()
    expect(parseLineWebhookBody(JSON.stringify({ events: [] }))).toBeNull()
  })
})

describe('normalizeLineEvent', () => {
  it('テキストメッセージ → inbound text レコード', () => {
    const record = normalizeLineEvent({
      ...BASE,
      type: 'message',
      replyToken: 'reply-1',
      message: { id: 'msg-100', type: 'text', text: '請求書を送ります' },
    })

    expect(record).toEqual({
      kind: 'message',
      externalUserId: 'U4af4980629',
      externalMessageId: 'msg-100',
      webhookEventId: '01FZ74A0TDDAYD9ZE83E79XM64',
      isRedelivery: false,
      contentType: 'text',
      body: '請求書を送ります',
      occurredAt: new Date(1750000000000).toISOString(),
      payload: {},
    })
  })

  it('画像メッセージ → body無し・content参照だけ payload に残す', () => {
    const record = normalizeLineEvent({
      ...BASE,
      type: 'message',
      replyToken: 'reply-1',
      message: {
        id: 'msg-200',
        type: 'image',
        contentProvider: { type: 'line' },
      },
    })

    expect(record).toMatchObject({
      kind: 'message',
      contentType: 'image',
      body: null,
      payload: { lineMessageId: 'msg-200', contentProvider: 'line' },
    })
  })

  it('follow → system レコード', () => {
    const record = normalizeLineEvent({ ...BASE, type: 'follow', replyToken: 'reply-2' })
    expect(record).toMatchObject({
      kind: 'follow',
      externalUserId: 'U4af4980629',
      contentType: 'system',
      body: null,
    })
  })

  it('unfollow → system レコード', () => {
    const record = normalizeLineEvent({ ...BASE, type: 'unfollow' })
    expect(record).toMatchObject({ kind: 'unfollow', contentType: 'system' })
  })

  it('userId の無い source（group等）は null', () => {
    const record = normalizeLineEvent({
      ...BASE,
      source: { type: 'group', groupId: 'G1' },
      type: 'message',
      message: { id: 'm', type: 'text', text: 'x' },
    })
    expect(record).toBeNull()
  })

  it('対応外イベント（postback等）は null', () => {
    expect(normalizeLineEvent({ ...BASE, type: 'postback', postback: { data: 'x' } })).toBeNull()
  })
})
