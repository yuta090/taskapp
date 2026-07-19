import { NextRequest, NextResponse } from 'next/server'
import { dispatchTaskMirrorBatch } from '@/lib/google-tasks/mirror'

export const runtime = 'nodejs'

/**
 * POST /api/cron/task-mirror-dispatch
 *
 * pg_cron が5分間隔で app_invoke_task_mirror('dispatch') 経由(pg_net)で叩く内部API。
 * user_task_mirror_jobs を claim して Google Tasks へ順方向反映する。
 * 認証: Authorization: Bearer ${CRON_SECRET}(sink-dispatch と同一パターン)。
 */
export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('[task-mirror-dispatch] CRON_SECRET is not configured')
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }

  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const summary = await dispatchTaskMirrorBatch()
  return NextResponse.json(summary)
}
