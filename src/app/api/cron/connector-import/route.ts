import { NextRequest, NextResponse } from 'next/server'
import { importGoogleTasksBatch } from '@/lib/google-tasks/import'

export const runtime = 'nodejs'

/**
 * POST /api/cron/connector-import
 *
 * pg_cron が15分間隔で app_invoke_connector('import') 経由(pg_net)で叩く内部API。
 * import_enabled な google_tasks 接続を updatedMin(poll_cursor)で差分ポーリングし、
 * 外部起案タスクを TaskApp へ取り込む(origin=external)。multica は webhook push のため poll 不要。
 * 認証: Authorization: Bearer ${CRON_SECRET}。
 */
export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('[connector-import] CRON_SECRET is not configured')
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }

  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const summary = await importGoogleTasksBatch()
  return NextResponse.json(summary)
}
