import { NextRequest, NextResponse } from 'next/server'
import { reconcileDmReachability } from '@/lib/channels/dmReachabilityReconcile'

export const runtime = 'nodejs'

/**
 * POST /api/cron/dm-reachability-reconcile
 *
 * pg_cron が定期的に app_invoke_dm_reachability_reconcile 経由(pg_net)で叩く内部API。
 * DM到達不能「安全網」の仕上げ（日次照合の回収ジョブ）。webhookのunfollow/follow
 * (markDmUnreachable/clearDmUnreachable・設計正本 §9.1)は「導入前から既にブロック済み」
 * 「unfollowイベント自体の取りこぼし」を検知できないため、LINE 1:1 profile取得で
 * 実際の到達可否を照合し直し、既存のmark/clearへ委譲する（reconcileDmReachability参照）。
 *
 * 認証: Authorization: Bearer ${CRON_SECRET}（他cronと同一パターン）。
 */
export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('[dm-reachability-reconcile] CRON_SECRET is not configured')
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }

  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const summary = await reconcileDmReachability()
  return NextResponse.json(summary)
}
