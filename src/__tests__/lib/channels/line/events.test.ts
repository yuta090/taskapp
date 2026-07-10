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
      replyToken: 'reply-1',
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

  it('グループの匿名メンバー発言（userIdなし）は groupId 付きで記録対象になる', () => {
    const record = normalizeLineEvent({
      ...BASE,
      source: { type: 'group', groupId: 'G1' },
      type: 'message',
      message: { id: 'm', type: 'text', text: 'x' },
    })
    expect(record).toMatchObject({
      kind: 'message',
      externalUserId: null,
      groupId: 'G1',
      body: 'x',
    })
  })

  it('グループの記名メンバー発言は userId と groupId の両方を保持する', () => {
    const record = normalizeLineEvent({
      ...BASE,
      source: { type: 'group', groupId: 'G1', userId: 'U-member' },
      type: 'message',
      message: { id: 'm2', type: 'text', text: 'y' },
    })
    expect(record).toMatchObject({ externalUserId: 'U-member', groupId: 'G1' })
  })

  it('room（複数人トーク）のメッセージは非サポートで null', () => {
    const record = normalizeLineEvent({
      ...BASE,
      source: { type: 'room', roomId: 'R1' },
      type: 'message',
      message: { id: 'm3', type: 'text', text: 'z' },
    })
    expect(record).toBeNull()
  })

  it('対応外イベント（beacon等）は null', () => {
    expect(normalizeLineEvent({ ...BASE, type: 'beacon' })).toBeNull()
  })

  it('join（グループ招待）→ kind=join・groupId 付きの system レコード', () => {
    const record = normalizeLineEvent({
      ...BASE,
      source: { type: 'group', groupId: 'G1' },
      type: 'join',
    })
    expect(record).toMatchObject({ kind: 'join', groupId: 'G1', contentType: 'system' })
  })

  it('join（room招待）→ kind=room_join・roomId 付き（非サポート案内→退出用）', () => {
    const record = normalizeLineEvent({
      ...BASE,
      source: { type: 'room', roomId: 'R1' },
      type: 'join',
    })
    expect(record).toMatchObject({ kind: 'room_join', roomId: 'R1', contentType: 'system' })
  })

  it('leave（グループ退出）→ kind=leave・groupId 付き', () => {
    const record = normalizeLineEvent({
      ...BASE,
      source: { type: 'group', groupId: 'G1' },
      type: 'leave',
    })
    expect(record).toMatchObject({ kind: 'leave', groupId: 'G1' })
  })

  it('postback → kind=postback・postbackData に data をそのまま保持', () => {
    const record = normalizeLineEvent({
      ...BASE,
      source: { type: 'group', groupId: 'G1' },
      type: 'postback',
      postback: { data: 'action=digest_done&task=abc-123' },
    })
    expect(record).toMatchObject({
      kind: 'postback',
      groupId: 'G1',
      postbackData: 'action=digest_done&task=abc-123',
    })
  })

  it('postback.data 欠落は null', () => {
    expect(
      normalizeLineEvent({ ...BASE, source: { type: 'group', groupId: 'G1' }, type: 'postback' }),
    ).toBeNull()
  })
})
