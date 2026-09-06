/**
 * 配列の各要素に非同期処理を当てる。同時に走る数を `limit` までに抑え、結果は入力順で返す。
 * 外部API（GoTrue の getUserById など）を人数分呼ぶときに、一斉に投げてレート制限に当たるのを防ぐ。
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return results
}
