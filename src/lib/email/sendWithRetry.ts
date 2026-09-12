import type { CreateEmailOptions, CreateEmailResponse, Resend } from 'resend'

/**
 * Resend の送信回数の上限（チーム単位で1秒あたり10件が既定
 * https://resend.com/docs/api-reference/errors#rate-limit-exceeded）にかかったときだけ、
 * 間隔を空けて数回だけ数え直す。それ以外の理由（宛先不正など）はそのまま返し、無限に粘らない。
 * 上限にかかったかどうかは `error.name === 'rate_limit_exceeded'` を主に見るが、
 * 返り方が違う場合に備えて `error.statusCode === 429` でも拾う。
 *
 * cron のように受信者が多い一斉送信は `mapWithRateLimit`（送り出す間隔そのものを空ける）と
 * 組み合わせて使う。この関数は、それでも重なって断られたときの最後の安全網。
 */
const DEFAULT_MAX_RETRIES = 3
const RETRY_DELAY_MS = 1100

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRateLimitError(error: { name: string; statusCode: number | null }): boolean {
  return error.name === 'rate_limit_exceeded' || error.statusCode === 429
}

export async function sendEmailWithRetry(
  resend: Resend,
  payload: CreateEmailOptions,
  maxRetries: number = DEFAULT_MAX_RETRIES
): Promise<CreateEmailResponse> {
  let attempt = 0

  while (true) {
    const result = await resend.emails.send(payload)

    if (!result.error || !isRateLimitError(result.error) || attempt >= maxRetries) {
      return result
    }

    attempt += 1
    await sleep(RETRY_DELAY_MS * attempt)
  }
}
