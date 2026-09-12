/**
 * cron の一斉メール送信で使う、送信サービス（Resend）の回数の上限に合わせた間隔。
 * 公式ドキュメント（https://resend.com/docs/api-reference/errors#rate-limit-exceeded）の
 * 既定値「The default maximum rate limit is 10 requests per second per team」（チーム単位で
 * 1秒あたり10件）に対し、1.1秒あたり4件（≒3.6件/秒）にしている。
 * この上限はチーム単位（鍵ごとではない）なので、複数の cron（毎朝のまとめ・5分おきの
 * 即時まとめ・期限リマインド）が重なって同時に走ると足し算になる。上限の半分（5件）
 * ではなく4件にして、重なったときの余裕を残している。
 */
export const EMAIL_SEND_RATE_LIMIT = {
  concurrency: 4,
  intervalMs: 1100,
} as const
