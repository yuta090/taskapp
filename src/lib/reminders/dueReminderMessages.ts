import type { DueReminderKind } from './dueReminderPlanner'

/**
 * 期限リマインドの文面（設計正本 §9・PR-1）。
 *
 * kind × ball の型（v1a・PR-1はtextのみ・ボタンなし。確認ボタンはPR-2）:
 *   - ball='client'（催促ナッジ）: 相手先への催促を促す
 *   - ball='internal'（対応ナッジ）: 担当者自身の対応を促す
 * ball は宛先を変えない（§9・宛先は常に内側担当者）。変わるのは文面だけ。
 */

/** メッセージ層で扱う ball（tasks.ball の 'agency'/'vendor' は §9対象外・internal 扱いに丸める）。 */
export type DueReminderBall = 'client' | 'internal'

export interface BuildDueReminderTextInput {
  kind: DueReminderKind
  ball: DueReminderBall
  title: string
  /** 表示用（現行テンプレは日付文字列を直接埋め込まない。将来の文面変更に備えてシグネチャに残す） */
  dueDate?: string
  /** スヌーズ通番（PR-2・send_count）。1以上なら再通知である旨を末尾に添える。 */
  snoozeCount?: number
}

const WHEN_LABEL: Record<'due_soon' | 'due_today', string> = {
  due_soon: '明日',
  due_today: '今日',
}

/**
 * kind×ball から本文を組み立てる。overdue_confirm は「明日/今日」の区別が無い一本の文面。
 */
export function buildDueReminderText(input: BuildDueReminderTextInput): string {
  const { kind, ball, title, snoozeCount } = input

  let body: string
  if (kind === 'overdue_confirm') {
    body =
      ball === 'client'
        ? `『${title}』の期限が過ぎています。相手先に催促をお願いします。`
        : `『${title}』の期限が過ぎています。状況をご確認ください。`
  } else {
    const when = WHEN_LABEL[kind]
    body =
      ball === 'client'
        ? `『${title}』の期限が${when}です。相手先への催促はお済みですか？`
        : `『${title}』の期限が${when}です。対応をお願いします。`
  }

  if (typeof snoozeCount === 'number' && snoozeCount > 0) {
    body += `\n（${snoozeCount}回目の再通知です）`
  }

  return body
}

/** channel-digest の期限セクション（§9・Free org向け・occurrence非依存）に載せる1件。 */
export interface DueDigestItem {
  kind: DueReminderKind
  ball: DueReminderBall
  title: string
}

/**
 * digest本文に足す期限セクション。対象0件なら空文字（呼び出し側は空欄を作らずそのまま無視できる）。
 * 申し送りタスクが0件（due-onlyのpush）でも単独で成立する本文になるよう、先頭に空行を
 * 前置しない（既存digest本文と組み合わせる際の区切りは呼び出し側の責務）。
 */
export function buildDueDigestSectionText(items: DueDigestItem[]): string {
  if (items.length === 0) return ''
  const lines = items.map((item) =>
    buildDueReminderText({ kind: item.kind, ball: item.ball, title: item.title }),
  )
  return ['⏰期限のお知らせ', ...lines].join('\n')
}
