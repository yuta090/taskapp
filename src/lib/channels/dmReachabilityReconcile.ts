import { listActiveOrgDmLinks, markDmUnreachable, clearDmUnreachable } from '@/lib/channels/store'
import { fetchLineUserProfile } from '@/lib/channels/line/client'

/**
 * DM到達不能「安全網」の仕上げ: 日次照合の回収ジョブ（cron `app_invoke_dm_reachability_reconcile`
 * 経由・POST /api/cron/dm-reachability-reconcile が叩く）。
 *
 * webhookのunfollow/follow(markDmUnreachable/clearDmUnreachable・設計正本 §9.1)は
 * 「導入前から既にブロック済み」「unfollowイベント自体の取りこぼし」を検知できない。
 * listActiveOrgDmLinks（owner_type='org'のactiveな1:1紐付け・DMは自社LINEのみ§7）を一覧し、
 * LINE 1:1 profile取得（fetchLineUserProfile）で実際の到達可否を照合し直し、
 * 既存のmark/clearへそのまま委譲する（新しい判定は発明しない）。
 *
 * - unreachable かつ未mark → markDmUnreachable
 * - reachable かつmark済み → clearDmUnreachable
 * - error（レート制限・5xx・ネットワーク） → 判定保留・何もしない
 * - 既に同じ状態なら冪等に何もしない（無駄な書き込みをしない）
 * - 1件の失敗（mark/clear自体のDB例外）で全体を落とさない（ベストエフォート・次のlinkへ継続）
 * - LINE profile APIを連続で叩かないよう、link間に軽いthrottleを挟む
 * - 上限件数(limit)に達したら残りは次回の実行に委ねる（cursorは持たない。現状の対象件数は
 *   小さく、上限は将来の増加に備えた安全弁。恒久的な取りこぼし対策にはcursor永続化が要るが
 *   migrationはこのPRの範囲外）
 */

const DEFAULT_LIMIT = 500
const DEFAULT_THROTTLE_MS = 50

export interface DmReachabilityReconcileSummary {
  /** 実際に照合を試みた件数（limit適用後） */
  scanned: number
  /** markDmUnreachableを呼んだ件数 */
  marked: number
  /** clearDmUnreachableを呼んだ件数 */
  cleared: number
  /** mark/clear呼び出し自体が例外を投げた件数（ベストエフォートでスキップした件数） */
  errors: number
  /** 対象件数がlimitを超え、一部を次回に持ち越したか */
  truncated: boolean
}

export interface ReconcileDmReachabilityOptions {
  limit?: number
  throttleMs?: number
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function reconcileDmReachability(
  options: ReconcileDmReachabilityOptions = {},
): Promise<DmReachabilityReconcileSummary> {
  const limit = options.limit ?? DEFAULT_LIMIT
  const throttleMs = options.throttleMs ?? DEFAULT_THROTTLE_MS

  const summary: DmReachabilityReconcileSummary = {
    scanned: 0,
    marked: 0,
    cleared: 0,
    errors: 0,
    truncated: false,
  }

  const links = await listActiveOrgDmLinks()
  const truncated = links.length > limit
  const target = truncated ? links.slice(0, limit) : links
  summary.truncated = truncated
  if (truncated) {
    console.info(
      `[dm-reachability-reconcile] batch limit reached: ${links.length} eligible, processing ${limit} (rest deferred to next run)`,
    )
  }

  for (let i = 0; i < target.length; i++) {
    const link = target[i]
    summary.scanned++
    try {
      const result = await fetchLineUserProfile(link.accessToken, link.externalUserId)
      if (result === 'unreachable' && !link.dmUnreachableAt) {
        await markDmUnreachable(link.orgId, link.accountId, link.externalUserId, new Date().toISOString())
        summary.marked++
      } else if (result === 'reachable' && link.dmUnreachableAt) {
        await clearDmUnreachable(link.orgId, link.accountId, link.externalUserId, new Date().toISOString())
        summary.cleared++
      }
      // result === 'error' は判定保留。既に同じ状態(unreachable×mark済み／reachable×未mark)
      // のときも冪等に何もしない。
    } catch (err) {
      summary.errors++
      console.error('[dm-reachability-reconcile] link check failed (continuing):', err)
    }

    if (throttleMs > 0 && i < target.length - 1) {
      await sleep(throttleMs)
    }
  }

  console.info(
    `[dm-reachability-reconcile] scanned=${summary.scanned} marked=${summary.marked} cleared=${summary.cleared} errors=${summary.errors} truncated=${summary.truncated}`,
  )
  return summary
}
