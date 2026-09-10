/**
 * tasks.short_id（サービス全体の通し番号。DBトリガーで自動採番される実在列）を
 * CLI/API 出力に表示するための整形。アプリ側(src/lib/tasks/taskNumber.ts)と表記を
 * 揃えるためプレフィックスは同じ 'TP' を使う（パッケージ間 import ができないため複製）。
 */
export const TASK_NUMBER_PREFIX = 'TP'

export function formatTaskNumber(shortId: number | null | undefined): string | null {
  if (shortId === null || shortId === undefined) return null
  return `${TASK_NUMBER_PREFIX}-${shortId}`
}

/**
 * タスク行に number(TP-番号) を足す。CLI の表表示(packages/cli/src/output.ts の
 * printTable)は「先頭8列」しか出さないため、number を**先頭キー**にする
 * （末尾に足すと8列目からはみ出て見えなくなる）。他の値は変えない。
 */
export function withTaskNumber<T extends { short_id?: number | null }>(
  row: T
): { number: string | null; title: unknown; status: unknown; ball: unknown; due_date: unknown; id: unknown; org_id: unknown; space_id: unknown } & T {
  const r = row as Record<string, unknown>
  return {
    number: formatTaskNumber(row.short_id),
    title: r.title,
    status: r.status,
    ball: r.ball,
    due_date: r.due_date,
    id: r.id,
    org_id: r.org_id,
    space_id: r.space_id,
    ...row,
  }
}
