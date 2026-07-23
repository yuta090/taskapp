import { createHash } from 'node:crypto'
import { buildDueReminderDonePostbackData } from '@/lib/reminders/dueReminderPostback'
import { buildDoneSuggestDismissPostbackData } from './postback'
import type { LineFlexMessage } from '@/lib/channels/line/client'

/**
 * 完了サジェストの文面＋確認Flex（Fable裁定「完了サジェスト」v1）。
 *
 * 「『X』は完了しましたか？」＋[完了した][まだ]の1回きりのDM私信。自動完了はしない
 * （[完了した]を押して初めて既存の rpc_confirm_task_done_via_line が走る）。
 *
 * [完了した]は新規に発明せず、既存の期限リマインド確認ループの done postback
 * （buildDueReminderDonePostbackData）をそのまま再利用する — webhookHandlerの
 * processPostback は既にこのpostbackを rpc_confirm_task_done_via_line へ配線済み。
 */
export function buildDoneSuggestText(title: string): string {
  return `「${title}」は完了しましたか？`
}

export interface BuildDoneSuggestFlexInput {
  title: string
  taskId: string
}

export function buildDoneSuggestFlex(input: BuildDoneSuggestFlexInput): LineFlexMessage {
  const { title, taskId } = input
  const text = buildDoneSuggestText(title)

  return {
    type: 'flex',
    altText: text,
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [{ type: 'text', text, wrap: true }],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'button',
            style: 'primary',
            action: {
              type: 'postback',
              label: '完了した',
              data: buildDueReminderDonePostbackData(taskId),
              displayText: '完了した',
            },
          },
          {
            type: 'button',
            style: 'secondary',
            action: {
              type: 'postback',
              label: 'まだ',
              data: buildDoneSuggestDismissPostbackData(taskId),
              displayText: 'まだ',
            },
          },
        ],
      },
    },
  }
}

/**
 * 決定的なretryKey（task_id基準）。同一task_idなら常に同じキーになるため、
 * webhook再配送・複数worker競合でも sendSecretaryPush → LINE の X-Line-Retry-Key dedupe が効く。
 *
 * digest/compute.ts の buildDigestRetryKey・due-reminder-sender の buildDueReminderRetryKey と
 * 同じ sha256→UUID v4 形状の整形手法に揃える（LINEがX-Line-Retry-KeyをUUID厳格検証するため）。
 */
export function buildDoneSuggestRetryKey(taskId: string): string {
  const raw = `done-suggest:${taskId}`
  const hex = createHash('sha256').update(raw).digest('hex')
  const variantNibble = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${variantNibble}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-')
}
