import { NextRequest, NextResponse } from 'next/server'
import { runTaskSyncImport } from '@/lib/task-sync/runner'

export const runtime = 'nodejs'

/**
 * POST /api/cron/task-sync-import
 *
 * pg_cron が15分間隔で app_invoke_connector('task_sync') 経由(pg_net)で叩く内部API。
 * import_enabled なタスク同期接続（Backlog / Jooto / Jira / Redmine / Asana / Trello / Linear）を
 * 差分ポーリングして TaskApp へ取り込む。
 *
 * gtasks / multica は既存の別ジョブ（connector-import / connector-dispatch）が担当し続ける。
 * この経路はアダプタ登録表にあるツールだけを見るため、二重取り込みにはならない。
 *
 * ツールごとの呼び出し回数上限（例: Jooto は標準プランで月100回）はランナー側が
 * アダプタ宣言 minPollIntervalMinutes に従って見送るので、cron 側の間隔は一本でよい。
 *
 * 認証: Authorization: Bearer ${CRON_SECRET}（既存 cron ルートと同じ）。
 */
export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('[task-sync-import] CRON_SECRET is not configured')
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }

  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const summary = await runTaskSyncImport()
  return NextResponse.json(summary)
}
