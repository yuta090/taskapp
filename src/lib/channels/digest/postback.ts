import { isValidUuid } from '@/lib/uuid'

/**
 * digest消し込みボタン（Flex Message の postback action）の data 形式:
 * `action=digest_done&task=<uuid>`
 */

export function parseDigestDonePostback(data: string): { taskId: string } | null {
  let params: URLSearchParams
  try {
    params = new URLSearchParams(data)
  } catch {
    return null
  }
  if (params.get('action') !== 'digest_done') return null
  const taskId = params.get('task')
  if (!isValidUuid(taskId)) return null
  return { taskId }
}

export function buildDigestDonePostbackData(taskId: string): string {
  return `action=digest_done&task=${taskId}`
}
