/**
 * 送信サービス（メール等）の「1秒あたりの回数」の上限に合わせて、一斉に投げず
 * concurrency 件ずつ・intervalMs おきに実行する Promise.allSettled 相当の道具。
 * cron のように受信者が多い一斉送信で、上限を超えて一部が断られるのを防ぐために使う。
 */
export interface RateLimitOptions<R = unknown> {
  /** 一度に実行してよい件数 */
  concurrency: number
  /** 次の concurrency 件を始めるまで待つ時間(ms) */
  intervalMs: number
  /**
   * 1かたまりの送信（Promise.allSettled）が終わるたびに、次のかたまりの間隔待ちを
   * 挟む前に呼ばれる。ここで「送った印」を保存すると、関数が途中で打ち切られても、
   * それまでに送り終えたかたまりぶんは記録が残る（全部終わってからまとめて保存すると、
   * 打ち切られた回はどこにも記録が残らず、次の実行で二重に送ってしまう）。
   */
  onChunkSettled?: (chunkResults: PromiseSettledResult<R>[]) => void | Promise<void>
}

export async function mapWithRateLimit<T, R>(
  items: T[],
  task: (item: T) => Promise<R>,
  options: RateLimitOptions<R>
): Promise<PromiseSettledResult<R>[]> {
  const { concurrency, intervalMs, onChunkSettled } = options
  const results: PromiseSettledResult<R>[] = []

  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency)
    const chunkResults = await Promise.allSettled(chunk.map(task))
    results.push(...chunkResults)
    if (onChunkSettled) await onChunkSettled(chunkResults)

    const isLastChunk = i + concurrency >= items.length
    if (!isLastChunk) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
  }

  return results
}
