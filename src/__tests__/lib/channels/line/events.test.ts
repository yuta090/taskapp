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

  describe('mention正規化（Stage 2.5 §2）', () => {
    it('mentionees[].isSelf===true があれば mentionsSelf=true・selfMentionSpans に位置を残す', () => {
      const record = normalizeLineEvent({
        ...BASE,
        source: { type: 'group', groupId: 'G1' },
        type: 'message',
        message: {
          id: 'm-mention-1',
          type: 'text',
          text: '@AgentPM秘書 金曜までに見積提出',
          mention: {
            mentionees: [{ index: 0, length: 8, type: 'user', isSelf: true }],
          },
        },
      })
      expect(record).toMatchObject({
        mentionsSelf: true,
        selfMentionSpans: [{ index: 0, length: 8 }],
      })
    })

    it('mentionees があっても isSelf===true が無ければ mentionsSelf は undefined', () => {
      const record = normalizeLineEvent({
        ...BASE,
        source: { type: 'group', groupId: 'G1' },
        type: 'message',
        message: {
          id: 'm-mention-2',
          type: 'text',
          text: '@田中さん お願いします',
          mention: {
            mentionees: [{ index: 0, length: 5, type: 'user', isSelf: false }],
          },
        },
      })
      expect(record?.mentionsSelf).toBeUndefined()
      expect(record?.selfMentionSpans).toBeUndefined()
    })

    it('他人宛メンションの userId を assigneeMentions に残す（Stage 2.6）', () => {
      const record = normalizeLineEvent({
        ...BASE,
        source: { type: 'group', groupId: 'G1' },
        type: 'message',
        message: {
          id: 'm-mention-assignee-1',
          type: 'text',
          // メンション区間はUTF-16の [index, length)。'@秘書'=0..2, '@山田'=4..6
          text: '@秘書 @山田 金曜17時までに酒屋へ発注',
          mention: {
            mentionees: [
              { index: 0, length: 3, type: 'user', isSelf: true },
              { index: 4, length: 3, type: 'user', userId: 'U-yamada' },
            ],
          },
        },
      })
      expect(record?.assigneeMentions).toEqual([
        { index: 4, length: 3, userId: 'U-yamada', displayName: '山田' },
      ])
    })

    it('userId が取れないメンション（プロフィール取得未同意）でも表示名は残す（Stage 2.6）', () => {
      const record = normalizeLineEvent({
        ...BASE,
        source: { type: 'group', groupId: 'G1' },
        type: 'message',
        message: {
          id: 'm-mention-assignee-2',
          type: 'text',
          text: '@田中 お願いします',
          mention: {
            mentionees: [{ index: 0, length: 3, type: 'user' }],
          },
        },
      })
      expect(record?.assigneeMentions).toEqual([
        { index: 0, length: 3, userId: null, displayName: '田中' },
      ])
    })

    it('@all（type:"all"）は担当と見なさない（Stage 2.6）', () => {
      const record = normalizeLineEvent({
        ...BASE,
        source: { type: 'group', groupId: 'G1' },
        type: 'message',
        message: {
          id: 'm-mention-assignee-3',
          type: 'text',
          text: '@all 明日までに提出',
          mention: {
            mentionees: [{ index: 0, length: 4, type: 'all' }],
          },
        },
      })
      expect(record?.assigneeMentions).toBeUndefined()
    })

    it('夜間抽出のため mentionees を payload に保存する（Stage 2.6）', () => {
      const record = normalizeLineEvent({
        ...BASE,
        source: { type: 'group', groupId: 'G1' },
        type: 'message',
        message: {
          id: 'm-mention-assignee-4',
          type: 'text',
          text: '@山田 金曜までに発注',
          mention: {
            mentionees: [{ index: 0, length: 3, type: 'user', userId: 'U-yamada' }],
          },
        },
      })
      // payload に残さないと all モードの夜間抽出で「誰宛だったか」を復元できない
      expect(record?.payload).toEqual({
        mentionees: [{ index: 0, length: 3, userId: 'U-yamada', displayName: '山田' }],
      })
    })

    it('mention フィールド自体が無いテキストは mentionsSelf が undefined', () => {
      const record = normalizeLineEvent({
        ...BASE,
        source: { type: 'group', groupId: 'G1' },
        type: 'message',
        message: { id: 'm-mention-3', type: 'text', text: '普通の発言' },
      })
      expect(record?.mentionsSelf).toBeUndefined()
      expect(record?.selfMentionSpans).toBeUndefined()
    })

    it('text以外（画像等）は mention を解析しない', () => {
      const record = normalizeLineEvent({
        ...BASE,
        source: { type: 'group', groupId: 'G1' },
        type: 'message',
        message: {
          id: 'm-mention-4',
          type: 'image',
          contentProvider: { type: 'line' },
        },
      })
      expect(record?.mentionsSelf).toBeUndefined()
      expect(record?.selfMentionSpans).toBeUndefined()
    })

    it('複数メンションのうち自分宛のものだけを selfMentionSpans に残す', () => {
      const record = normalizeLineEvent({
        ...BASE,
        source: { type: 'group', groupId: 'G1' },
        type: 'message',
        message: {
          id: 'm-mention-5',
          type: 'text',
          text: '@田中さん @AgentPM秘書 見積お願いします',
          mention: {
            mentionees: [
              { index: 0, length: 5, type: 'user', isSelf: false },
              { index: 6, length: 8, type: 'user', isSelf: true },
            ],
          },
        },
      })
      expect(record).toMatchObject({
        mentionsSelf: true,
        selfMentionSpans: [{ index: 6, length: 8 }],
      })
    })
  })
})
