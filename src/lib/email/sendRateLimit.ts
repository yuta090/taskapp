/**
 * cron の一斉メール送信で使う、送信サービス（Resend）の回数の上限に合わせた間隔。
 * 公式ドキュメント（https://resend.com/docs/api-reference/errors#rate-limit-exceeded）の
 * 既定値「The default maximum rate limit is 10 requests per second per team」（チーム単位で
 * 1秒あたり10件）の半分を使い、1.1秒あたり5件にしている。
 * 複数の cron（毎朝のまとめ・5分おきの即時まとめ・期限リマインド）で共通の値を使う。
 */
export const EMAIL_SEND_RATE_LIMIT = {
  concurrency: 5,
  intervalMs: 1100,
} as const
