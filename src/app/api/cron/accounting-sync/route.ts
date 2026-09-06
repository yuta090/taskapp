import { NextRequest, NextResponse } from 'next/server'
import { syncBillingDocumentsBatch } from '@/lib/accounting/sync'

export const runtime = 'nodejs'

/**
 * POST /api/cron/accounting-sync
 *
 * 発行済みの見積書・請求書の状態を会計サービスから取り直す（入金の取り込み）。
 * これが回ることで「まだ入金されていない請求」を TaskApp 側だけで把握できる。
 * 認証: Authorization: Bearer ${CRON_SECRET}。
 */
export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('[accounting-sync] CRON_SECRET is not configured')
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }

  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const summary = await syncBillingDocumentsBatch()
  return NextResponse.json(summary)
}
