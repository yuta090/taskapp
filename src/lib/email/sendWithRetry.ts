import type { CreateEmailOptions, CreateEmailResponse, Resend } from 'resend'

/**
 * Resend の送信回数の上限（1秒あたりの回数。既定は公式ドキュメントで2件/秒とされている）に
 * かかったとき（error.name === 'rate_limit_exceeded'）だけ、間隔を空けて数回だけ数え直す。
 * それ以外の理由（宛先不正など）はそのまま返し、無限に粘らない。
 *
 * cron のように受信者が多い一斉送信は `mapWithRateLimit`（送り出す間隔そのものを空ける）と
 * 組み合わせて使う。この関数は、それでも重なって断られたときの最後の安全網。
 */
const DEFAULT_MAX_RETRIES = 3
const RETRY_DELAY_MS = 1100

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function sendEmailWithRetry(
  resend: Resend,
  payload: CreateEmailOptions,
  maxRetries: number = DEFAULT_MAX_RETRIES
): Promise<CreateEmailResponse> {
  let attempt = 0

  while (true) {
    const result = await resend.emails.send(payload)

    if (!result.error || result.error.name !== 'rate_limit_exceeded' || attempt >= maxRetries) {
      return result
    }

    attempt += 1
    await sleep(RETRY_DELAY_MS * attempt)
  }
}
