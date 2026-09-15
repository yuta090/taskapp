import { describe, it, expect } from 'vitest'
import { NOTIFICATION_TYPE_GROUPS } from '@/app/(internal)/inbox/InboxClient'

/**
 * review_approved（社内承認が承認された通知）は、種別フィルターの「レビュー」に
 * review_request / review_cancelled と並べて出す。末尾に別グループとして足さない
 * （feat/task-comment-notify が末尾にコメント用グループを足すため、衝突を避ける）。
 */
describe('InboxClient — 種別フィルターのグループ', () => {
  it('レビューのグループに review_approved が含まれる', () => {
    const reviewGroup = NOTIFICATION_TYPE_GROUPS.find((g) => g.label === 'レビュー')
    expect(reviewGroup?.types).toEqual(['review_request', 'review_cancelled', 'review_approved'])
  })

  it('クライアント連絡のグループに client_approved が含まれる', () => {
    const clientGroup = NOTIFICATION_TYPE_GROUPS.find((g) => g.label === 'クライアント連絡')
    expect(clientGroup?.types).toEqual(['client_question', 'client_feedback', 'client_approved'])
  })
})
