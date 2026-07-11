import { NextRequest, NextResponse } from 'next/server'
import { dispatchBatch } from '@/lib/sinks/dispatcher'

export const runtime = 'nodejs'

/**
 * POST /api/cron/sink-dispatch
 *
 * pg_cron が5分間隔で app_invoke_sink_dispatch() 経由で pg_net から呼び出す内部API。
 * 認証: Authorization: Bearer ${CRON_SECRET}（client-reminders/channel-digestと同一パターン）。
 */
export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('[sink-dispatch] CRON_SECRET is not configured')
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }

  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const summary = await dispatchBatch()

  return NextResponse.json(summary)
}
