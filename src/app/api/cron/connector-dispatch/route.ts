import { NextRequest, NextResponse } from 'next/server'
import { dispatchConnectorJobsBatch } from '@/lib/connectors/dispatch'

export const runtime = 'nodejs'

/**
 * POST /api/cron/connector-dispatch
 *
 * pg_cron が5分間隔で app_invoke_connector('dispatch') 経由(pg_net)で叩く内部API。
 * connector_jobs を claim し、接続の provider ごとに配達する:
 *   - multica: issue.upsert / issue.cancel を送信
 *   - google_tasks: op='complete'(外部完了を Google 側 done へ書き戻す)
 * 認証: Authorization: Bearer ${CRON_SECRET}(task-mirror-dispatch と同一パターン)。
 */
export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('[connector-dispatch] CRON_SECRET is not configured')
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }

  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const summary = await dispatchConnectorJobsBatch()
  return NextResponse.json(summary)
}
