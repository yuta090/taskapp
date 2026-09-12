/**
 * 送信サービス（メール等）の「1秒あたりの回数」の上限に合わせて、一斉に投げず
 * concurrency 件ずつ・intervalMs おきに実行する Promise.allSettled 相当の道具。
 * cron のように受信者が多い一斉送信で、上限を超えて一部が断られるのを防ぐために使う。
 */
export interface RateLimitOptions {
  /** 一度に実行してよい件数 */
  concurrency: number
  /** 次の concurrency 件を始めるまで待つ時間(ms) */
  intervalMs: number
}

export async function mapWithRateLimit<T, R>(
  items: T[],
  task: (item: T) => Promise<R>,
  options: RateLimitOptions
): Promise<PromiseSettledResult<R>[]> {
  const { concurrency, intervalMs } = options
  const results: PromiseSettledResult<R>[] = []

  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency)
    const chunkResults = await Promise.allSettled(chunk.map(task))
    results.push(...chunkResults)

    const isLastChunk = i + concurrency >= items.length
    if (!isLastChunk) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
  }

  return results
}
