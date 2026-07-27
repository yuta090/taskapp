import { NextResponse } from 'next/server'
import { verifySuperadmin } from '@/lib/admin/verify-superadmin'
import { listApprovedQuotesWithOrg } from '@/lib/billing/quoteStore'
import { buildApprovedQuotesCsv } from '@/lib/billing/quotesCsv'

/**
 * GET /api/admin/quotes/export — 承認済み（＝毎月請求すべき）追加枠のCSV（superadmin専用）。
 *
 * 請求書払いが中心の現状では「金額さえ分かれば足りる」ため、Stripe への自動反映より先に
 * **経理へそのまま渡せる一覧**を出す。Excel で開く前提（BOM付き・日付はJST）。
 */
export async function GET() {
  const adminUserId = await verifySuperadmin()
  if (!adminUserId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { rows, truncated } = await listApprovedQuotesWithOrg()
  if (truncated) {
    // 全件を出せていない CSV をそのまま経理へ渡すと請求漏れになる。ログで気づけるようにする。
    console.error('[billing_quotes] CSV出力が全件ではない（承認済みが多すぎる）')
  }
  const csv = buildApprovedQuotesCsv(rows)

  // ファイル名は日付入り（毎月ダウンロードして保管する運用を想定）
  const stamp = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date())

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="quotes-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
