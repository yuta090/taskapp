/**
 * 期限リマインド確認ループ（設計正本 §7・PR-2）でボタンを押した人へ返す文言の正本。
 *
 * LINE（postback）と Slack（block_actions）の両方がここを読む。同じ文章を2箇所に書くと、
 * 片方だけ直したときにチャットごとに言われることが変わるため、必ずここに集約する。
 *
 * code review #5是正: forbidden/not_found/already_snoozed（世代不一致=旧ボタンの正当な無操作）は
 * 完全沈黙にするため、それらの文言は持たない（返信テキストを用意すると「用意されているのに
 * 出し分けるだけ」という誤読を招くため意図的に置かない）。
 */

export const DUE_REMINDER_DONE_FALLBACK_TEXT = 'タスクを完了にしました。'
export const DUE_REMINDER_ALREADY_DONE_TEXT = 'すでに完了済みです。'
export const DUE_REMINDER_BLOCKED_TEXT = 'アプリで内容を確認してください。'
export const DUE_REMINDER_SNOOZE_CAPPED_TEXT = '再通知の上限に達しました。'

export function buildDueReminderDoneReplyText(title: string): string {
  return `『${title}』を完了にしました。`
}

export function buildDueReminderSnoozedReplyText(days: number): string {
  return `${days}日後に再通知します。`
}
