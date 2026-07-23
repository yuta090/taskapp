import { isValidUuid } from '@/lib/uuid'

/**
 * 完了サジェストの[まだ]postback.data形式（Fable裁定「完了サジェスト」v1）。
 * digest/dueReminder のpostbackと同型・同作法:
 *
 *   `action=done_suggest_dismiss&task=<uuid>`
 *
 * [完了した]は新規に発明しない — 既存の due reminder done postback
 * （buildDueReminderDonePostbackData / rpc_confirm_task_done_via_line）をそのまま再利用する。
 * authz（口座×external_user_idからの内部ユーザー解決）はwebhookHandler側
 * （processDoneSuggestDismissPostback）が findActiveUserLinkByExternalId で行う。
 */

export function buildDoneSuggestDismissPostbackData(taskId: string): string {
  return `action=done_suggest_dismiss&task=${taskId}`
}

export function parseDoneSuggestDismissPostback(data: string): { taskId: string } | null {
  let params: URLSearchParams
  try {
    params = new URLSearchParams(data)
  } catch {
    return null
  }
  if (params.get('action') !== 'done_suggest_dismiss') return null

  const taskId = params.get('task')
  if (!isValidUuid(taskId)) return null
  return { taskId }
}
