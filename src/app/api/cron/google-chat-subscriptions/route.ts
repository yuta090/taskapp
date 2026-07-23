import { NextRequest, NextResponse } from 'next/server'
import {
  reconcileGoogleChatSubscriptions,
  type GoogleChatSubscriptionReconcilerDeps,
} from '@/lib/channels/google-chat/subscriptionReconciler'
import {
  listActiveClaimedGroupsWithoutActiveSubscription,
  createEventSubscription,
  setEventSubscriptionResource,
  listSubscriptionsToRenew,
  listOrphanedActiveSubscriptions,
  markSubscriptionStatus,
} from '@/lib/channels/store'
import {
  createChatSubscription,
  renewChatSubscription,
  deleteChatSubscription,
} from '@/lib/channels/google-chat/client'

export const runtime = 'nodejs'

/**
 * POST /api/cron/google-chat-subscriptions — PR-d: 購読ライフサイクルの自己修復cron。
 *
 * pg_cron が10分間隔で叩く内部API（onboarding遅延を抑えるため他cronより短い間隔）。
 * inline hookは無し。「active claimed google_chat グループには生きた購読があり、
 * そうでない購読は消えている」状態へ毎回収束させる（create-missing / renew-expiring /
 * delete-orphaned の3フェーズ・reconcileGoogleChatSubscriptions）。
 * 認証: Authorization: Bearer ${CRON_SECRET}（他cronと同一パターン）。
 */
const deps: GoogleChatSubscriptionReconcilerDeps = {
  listMissing: () => listActiveClaimedGroupsWithoutActiveSubscription(),
  createSubscription: (spaceName) => createChatSubscription(spaceName),
  createSubscriptionRow: (input) => createEventSubscription(input),
  setSubscriptionResource: (id, resourceName, expireTime) =>
    setEventSubscriptionResource(id, resourceName, expireTime),
  listToRenew: (beforeIso) => listSubscriptionsToRenew(beforeIso),
  renewSubscription: (resourceName) => renewChatSubscription(resourceName),
  listOrphaned: () => listOrphanedActiveSubscriptions(),
  deleteSubscription: (resourceName) => deleteChatSubscription(resourceName),
  markSubscriptionStatus: (id, status, lastError) => markSubscriptionStatus(id, status, lastError),
}

export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('[google-chat-subscriptions] CRON_SECRET is not configured')
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }

  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const summary = await reconcileGoogleChatSubscriptions(deps)
  return NextResponse.json(summary)
}
