/**
 * Notion API の 429/503 応答が返す `Retry-After`（秒）を ms に変換する共通ヘルパー。
 *
 * providers/notion.ts（listContainers/listChangedTasks/completeTask 側の query 系呼び出し）と
 * providers/notion/schema.ts（databases.retrieve 側のスキーマ取得）の両方が使う。以前は
 * notion.ts 側にだけこのロジックがあり、schema.ts 側は 429/503 で Retry-After を読まず
 * retryAfterMs を載せていなかった（同じ接続の「スキーマ取得」と「取り込み実行」で挙動が食い違い、
 * レート制限中にスキーマ取得だけ復帰時刻を無視して叩き続けてしまう）。1箇所に集約して揃える。
 */
export function retryAfterMsFrom(headers: Headers | undefined): number | undefined {
  const raw = headers?.get('Retry-After')
  if (!raw) return undefined
  const sec = Number(raw)
  return Number.isFinite(sec) && sec > 0 ? sec * 1000 : undefined
}
