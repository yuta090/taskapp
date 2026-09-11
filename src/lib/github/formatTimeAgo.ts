/**
 * GitHub の PR・Issue 一覧で使う簡易的な相対時間表示。
 * PRBadge に閉じていたロジックを TaskIssueList とも共有するために切り出した
 * （PR-B: 列の絞り込みに伴い、Issue 側にも同じ「日付」表示を足すため）。
 */
export function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSecs = Math.floor(diffMs / 1000)
  const diffMins = Math.floor(diffSecs / 60)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffDays > 0) {
    return `${diffDays}日前`
  } else if (diffHours > 0) {
    return `${diffHours}時間前`
  } else if (diffMins > 0) {
    return `${diffMins}分前`
  } else {
    return 'たった今'
  }
}
