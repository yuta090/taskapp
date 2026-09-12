/**
 * cron の一斉メール送信で使う、送信サービス（Resend）の回数の上限に合わせた間隔。
 * 公式ドキュメントの既定値（1秒あたり2件）に、余裕を持たせて1.1秒おきにしている。
 * 複数の cron（毎朝のまとめ・5分おきの即時まとめ・期限リマインド）で共通の値を使う。
 */
export const EMAIL_SEND_RATE_LIMIT = {
  concurrency: 2,
  intervalMs: 1100,
} as const
