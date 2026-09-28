/**
 * /admin/cli-usage（運営専用）の「直近のログ」表で使う純粋な整形関数。
 * error_detail は呼んだ人には返らない、原因の詳細（構造化JSON）。運営がここで読む。
 */

/** error_detail(jsonb) を読める形の JSON 文字列にする。想定外の値でも例外を投げない */
export function formatErrorDetail(detail: unknown): string {
  if (detail === null || detail === undefined) return ''
  try {
    return JSON.stringify(detail, null, 2)
  } catch {
    // 循環参照など、JSON化できない値
    return String(detail)
  }
}

const SOURCE_LABELS: Record<string, string> = {
  cli: 'CLI',
  mcp: '外部チャット(MCP)',
}

/** source列(cli|mcp)を日本語ラベルにする。見覚えのない値はそのまま返す */
export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source
}
