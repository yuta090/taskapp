/**
 * コメントを書いた時刻を「○分前」の形で出す。タスクのコメント欄とダッシュボードの「最近のコメント」で共有する。
 * 1週間以上前は月日だけを出す。
 */
export function formatCommentTime(dateString: string, now: Date = new Date()): string {
  const date = new Date(dateString)
  const diffMs = now.getTime() - date.getTime()
  const diffMinutes = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffMinutes < 1) return 'たった今'
  if (diffMinutes < 60) return `${diffMinutes}分前`
  if (diffHours < 24) return `${diffHours}時間前`
  if (diffDays < 7) return `${diffDays}日前`

  return date.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })
}
