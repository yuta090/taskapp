/**
 * tasks.short_id（サービス全体の通し番号。DBトリガーで自動採番される実在列）を
 * 画面/CLIに表示するための整形。GitHub連携(task-linker.ts)がPRタイトル等から
 * 拾う `TP-番号` と表記を揃えるため、プレフィックスをここで一元管理する。
 */
export const TASK_NUMBER_PREFIX = 'TP'

export function formatTaskNumber(shortId: number | null | undefined): string | null {
  if (shortId === null || shortId === undefined) return null
  return `${TASK_NUMBER_PREFIX}-${shortId}`
}
