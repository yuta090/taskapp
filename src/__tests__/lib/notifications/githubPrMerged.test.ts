import { describe, it, expect } from 'vitest'
import { NOTIFICATION_TYPE_META, getNotificationTypeLabel } from '@/lib/notifications/labels'
import { getDeliveryPolicy } from '@/lib/notifications/delivery'
import { categorizeNotificationType } from '@/lib/notifications/digest'
import { isActionableNotification } from '@/lib/notifications/classify'

/**
 * github_pr_merged（タスクに紐づいたPRが取り込まれたときの社内通知）の登録漏れを防ぐ。
 * task_completed と同じ「知らせるだけ」の扱いだが、配信ポリシーだけは
 * 明示的にプッシュ即時・メールはまとめ（PUSH_ONLY）にする（仕様どおり）。
 */
describe('github_pr_merged 通知タイプの登録', () => {
  it('日本語名と説明がある', () => {
    expect(getNotificationTypeLabel('github_pr_merged')).toBe('PRの取り込み')
    expect(NOTIFICATION_TYPE_META.github_pr_merged?.description).toContain('取り込まれた')
  })

  it('配信ポリシー: プッシュは即時・メールはまとめ', () => {
    expect(getDeliveryPolicy('github_pr_merged')).toEqual({ push: 'immediate', email: 'digest' })
  })

  it('まとめメールの見出しは task_assigned 家族（task_completed と同じ）', () => {
    expect(categorizeNotificationType('github_pr_merged')).toBe('task_assigned')
  })

  it('アクションが必要な通知(ACTIONABLE)には含まれない（task_completed と同じ扱い）', () => {
    expect(isActionableNotification('github_pr_merged')).toBe(false)
  })
})
