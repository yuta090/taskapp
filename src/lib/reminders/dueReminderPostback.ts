import { isValidUuid } from '@/lib/uuid'

/**
 * 期限リマインド確認ループ（設計正本 docs/spec/AI_SECRETARY_STAGE5_DUE_REMINDERS.md §7・PR-2）の
 * postback.data 形式。digest postback（@/lib/channels/digest/postback.ts）と同型・同作法:
 *
 *   完了:   `action=due_reminder_done&task=<uuid>`
 *   スヌーズ（[まだ]/[○日後に再通知] 共通）:
 *     `action=due_reminder_snooze&occurrence=<uuid>&days=<正整数>&gen=<送信時のsend_count>`
 *
 * authz（口座×external_user_idからの内部ユーザー解決・org/space束縛）は
 * rpc_confirm_task_done_via_line / rpc_snooze_due_reminder_via_line が担う。ここでは
 * postback data の形式検証のみ行い、新方式のトークン機構は発明しない（§7・§14）。
 *
 * code review #2(HIGH)是正: snoozeボタンは「送信時のoccurrence.send_count（世代）」を`gen`に
 * 焼き込む。旧世代Flex（スヌーズ済み後も残っている古いボタン）の再送信・再タップによる
 * リプレイを RPC 側の世代比較（p_expected_send_count）で弾けるようにするため。done(完了)側は
 * 冪等（2連打は already_done で吸収）なので世代は不要。
 */

function getParam(data: string, action: string, key: string): string | null {
  let params: URLSearchParams
  try {
    params = new URLSearchParams(data)
  } catch {
    return null
  }
  if (params.get('action') !== action) return null
  return params.get(key)
}

export function buildDueReminderDonePostbackData(taskId: string): string {
  return `action=due_reminder_done&task=${taskId}`
}

export function parseDueReminderDonePostback(data: string): { taskId: string } | null {
  const taskId = getParam(data, 'due_reminder_done', 'task')
  if (!isValidUuid(taskId)) return null
  return { taskId }
}

export function buildDueReminderSnoozePostbackData(
  occurrenceId: string,
  days: number,
  expectedSendCount: number,
): string {
  return `action=due_reminder_snooze&occurrence=${occurrenceId}&days=${days}&gen=${expectedSendCount}`
}

/** 0以上の整数のみ許容する非負整数パーサ（send_countは0始まりのため`days`用の正整数チェックと分離）。 */
function parseNonNegativeInt(raw: string | null): number | null {
  if (raw === null || !/^\d+$/.test(raw)) return null
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 0) return null
  return value
}

export function parseDueReminderSnoozePostback(
  data: string,
): { occurrenceId: string; days: number; expectedSendCount: number } | null {
  let params: URLSearchParams
  try {
    params = new URLSearchParams(data)
  } catch {
    return null
  }
  if (params.get('action') !== 'due_reminder_snooze') return null

  const occurrenceId = params.get('occurrence')
  if (!isValidUuid(occurrenceId)) return null

  const daysRaw = params.get('days')
  if (daysRaw === null || !/^\d+$/.test(daysRaw)) return null
  const days = Number(daysRaw)
  if (!Number.isInteger(days) || days <= 0) return null

  const expectedSendCount = parseNonNegativeInt(params.get('gen'))
  if (expectedSendCount === null) return null

  return { occurrenceId, days, expectedSendCount }
}
