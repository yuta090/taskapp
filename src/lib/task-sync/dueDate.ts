import { formatDateToLocalString } from '@/lib/gantt/dateUtils'
import { jstNow } from '@/lib/datetime/jstNow'

/**
 * 外部ツールの「日時つき期日」を、TaskApp が扱うローカル日付 'YYYY-MM-DD' に落とす。
 *
 * なぜ専用の関数が要るのか（実際に踏んだ不具合）:
 *   `formatDateToLocalString(new Date(due))` は**サーバーのタイムゾーン**で日付を切り出す。
 *   本番の Vercel は UTC なので、Trello の `2026-07-31T15:00:00Z`（＝日本時間 8/1 0:00）が
 *   **7/31** として取り込まれる。利用者から見ると期日が1日早くずれ、リマインドも1日ずれる。
 *   CI（UTC）とローカル開発機（JST）で結果が変わるため、テストでしか気づけない類の不具合。
 *
 *   この製品の期日は一貫して**日本時間の暦日**で意味を持つ（期限リマインドも JST の暦日で
 *   組み立てられている）。したがって変換の基準は「サーバーのローカル」ではなく **JST 固定**。
 *
 * 日付のみの文字列（'2026-07-31'）を渡された場合は、そのまま返す（時刻情報が無いものを
 * タイムゾーン変換にかけると、それ自体が1日ずれの原因になる）。
 */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

export function externalDueToJstDate(due: string | null | undefined): string | null {
  if (!due) return null

  // 日付だけの表記は変換しない。'2026-07-31' を Date に通すとUTC 0時と解釈され、
  // JSTへ寄せた瞬間に 9時間ぶんの差で前日/翌日へ滑る余地が生まれる。
  const head = due.slice(0, 10)
  if (DATE_ONLY.test(due)) return head

  const parsed = new Date(due)
  if (Number.isNaN(parsed.getTime())) {
    // 解釈できない値。期日を捏造するより「期日なし」にする方が安全（誤った日付で催促しない）。
    return null
  }
  // jstNow は「ローカル getter が JST の値を返す Date」を作る既存の確立パターン。
  // それを日付文字列に落とすので、サーバーのタイムゾーンに依存しない。
  return formatDateToLocalString(jstNow(parsed))
}
