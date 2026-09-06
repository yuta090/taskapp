import { describe, it, expect } from 'vitest'
import {
  NOTIFICATION_TYPE_META,
  getNotificationTypeLabel,
  getNotificationTypeDescription,
  getNotificationChannelLabel,
} from '@/lib/notifications/labels'
import { ACTIONABLE_TYPES_ARRAY } from '@/lib/notifications/classify'

describe('getNotificationTypeLabel', () => {
  it('既知のタイプは日本語名を返す', () => {
    expect(getNotificationTypeLabel('review_request')).toBe('社内承認依頼')
    expect(getNotificationTypeLabel('ball_passed')).toBe('ボール移動')
    expect(getNotificationTypeLabel('digest_approval_request')).toBe('申し送りの承認依頼')
    expect(getNotificationTypeLabel('file_uploaded')).toBe('ファイル')
  })

  it('運営向け(システム)タイプにも日本語名がある', () => {
    expect(getNotificationTypeLabel('sink_error')).toBe('連携の配達エラー')
    expect(getNotificationTypeLabel('sink_disabled_relink')).toBe('連携の停止（再リンク）')
    expect(getNotificationTypeLabel('pool_ai_exhausted')).toBe('共有AIの上限到達')
    expect(getNotificationTypeLabel('group_claim_linked')).toBe('共有botグループ紐付け')
    expect(getNotificationTypeLabel('free_cap_upgrade')).toBe('無料通知枠の上限到達')
  })

  it('未知のタイプは「通知」を返す（落ちない）', () => {
    expect(getNotificationTypeLabel('something_new')).toBe('通知')
    expect(getNotificationTypeLabel('')).toBe('通知')
  })

  it('アクションが必要な全タイプに名前がある（英語のまま出ない）', () => {
    for (const t of ACTIONABLE_TYPES_ARRAY) {
      expect(NOTIFICATION_TYPE_META[t], t).toBeDefined()
      expect(getNotificationTypeLabel(t)).not.toBe('通知')
    }
  })
})

describe('getNotificationTypeDescription', () => {
  it('既知のタイプは一言説明を返す', () => {
    expect(getNotificationTypeDescription('ball_passed')).toContain('あなた')
  })

  it('未知のタイプは空文字を返す', () => {
    expect(getNotificationTypeDescription('something_new')).toBe('')
  })

  it('全タイプに説明が入っている（空説明の登録漏れを防ぐ）', () => {
    for (const [type, meta] of Object.entries(NOTIFICATION_TYPE_META)) {
      expect(meta.label.length, type).toBeGreaterThan(0)
      expect(meta.description.length, type).toBeGreaterThan(0)
    }
  })
})

describe('getNotificationChannelLabel', () => {
  it('チャンネルを日本語で返す', () => {
    expect(getNotificationChannelLabel('in_app')).toBe('アプリ内')
    expect(getNotificationChannelLabel('email')).toBe('メール')
    expect(getNotificationChannelLabel('line')).toBe('LINE')
    expect(getNotificationChannelLabel('slack')).toBe('Slack')
  })

  it('未知のチャンネルはそのまま返す', () => {
    expect(getNotificationChannelLabel('mystery')).toBe('mystery')
  })
})
