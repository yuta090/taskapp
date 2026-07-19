import { NextRequest, NextResponse } from 'next/server'
import { pollTaskMirrorBatch } from '@/lib/google-tasks/poll'

export const runtime = 'nodejs'

/**
 * POST /api/cron/task-mirror-poll
 *
 * pg_cron が15分間隔で app_invoke_task_mirror('poll') 経由(pg_net)で叩く内部API。
 * 各 google_tasks 接続を updatedMin で差分ポーリングし、Google 完了を TaskApp done へ逆流させる。
 * 認証: Authorization: Bearer ${CRON_SECRET}。
 */
export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('[task-mirror-poll] CRON_SECRET is not configured')
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }

  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const summary = await pollTaskMirrorBatch()
  return NextResponse.json(summary)
}
