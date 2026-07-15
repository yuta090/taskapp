import { isValidUuid } from '@/lib/uuid'

/**
 * digest消し込みボタン（Flex Message の postback action）の data 形式:
 * `action=digest_done&task=<uuid>`
 * 取り消しボタン（Stage 2.5 §3-2）は同型: `action=digest_undo&task=<uuid>`
 * 責任者確認（Stage 2.7-B）も同型: 承認 `action=digest_promote` / 却下 `action=digest_reject`
 */

function parseActionPostback(data: string, action: string): { taskId: string } | null {
  let params: URLSearchParams
  try {
    params = new URLSearchParams(data)
  } catch {
    return null
  }
  if (params.get('action') !== action) return null
  const taskId = params.get('task')
  if (!isValidUuid(taskId)) return null
  return { taskId }
}

export function parseDigestDonePostback(data: string): { taskId: string } | null {
  return parseActionPostback(data, 'digest_done')
}

export function buildDigestDonePostbackData(taskId: string): string {
  return `action=digest_done&task=${taskId}`
}

export function parseDigestUndoPostback(data: string): { taskId: string } | null {
  return parseActionPostback(data, 'digest_undo')
}

export function buildDigestUndoPostbackData(taskId: string): string {
  return `action=digest_undo&task=${taskId}`
}

export function parseDigestPromotePostback(data: string): { taskId: string } | null {
  return parseActionPostback(data, 'digest_promote')
}

export function buildDigestPromotePostbackData(taskId: string): string {
  return `action=digest_promote&task=${taskId}`
}

export function parseDigestRejectPostback(data: string): { taskId: string } | null {
  return parseActionPostback(data, 'digest_reject')
}

export function buildDigestRejectPostbackData(taskId: string): string {
  return `action=digest_reject&task=${taskId}`
}
