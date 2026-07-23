/**
 * Google Chat 購読ライフサイクルの自己修復cron（PR-d）。
 *
 * inline hook は作らない。「active claimed google_chat グループには生きた購読があり、
 * そうでない購読は消えている」状態へ毎回収束させる収束ループ一本（Fable設計）。
 * pg_cron から10分間隔で叩かれる想定（onboarding遅延を抑えるため）。
 *
 * 3フェーズを順に回す（deps注入の純関数。DB/Google API アクセスは全て呼び出し側=route.ts が
 * 実装を注入する）:
 *   1. create-missing: 未購読の claimed group に購読を作る。
 *   2. renew-expiring: 失効間近(猶予24h)の購読を延命する。
 *   3. delete-orphaned: claimed でなくなった group の購読を消す。
 *
 * 1件の失敗が他の件の処理を止めない（各件を try/catch で独立に処理する）。
 */

export interface GoogleChatMissingSubscriptionGroup {
  groupId: string
  orgId: string
  accountId: string
  spaceName: string
}

export interface GoogleChatSubscriptionToRenew {
  id: string
  subscriptionResourceName: string | null
}

export interface GoogleChatOrphanedSubscription {
  id: string
  subscriptionResourceName: string | null
}

export interface GoogleChatSubscriptionReconcilerDeps {
  /** create-missine対象の claimed group を列挙する（store.listActiveClaimedGroupsWithoutActiveSubscription） */
  listMissing: () => Promise<GoogleChatMissingSubscriptionGroup[]>
  /** Google側の購読作成（client.createChatSubscription）。ALREADY_EXISTS は呼び出し先で成功扱いに解決済み */
  createSubscription: (spaceName: string) => Promise<{ name: string; expireTime: string | null }>
  /** 購読行の作成（store.createEventSubscription） */
  createSubscriptionRow: (input: {
    orgId: string
    groupId: string
    accountId: string
    spaceName: string
  }) => Promise<{ id: string }>
  /** 購読行へリソース名/失効時刻をセット（store.setEventSubscriptionResource）。create/renew共用 */
  setSubscriptionResource: (id: string, resourceName: string, expireTime: string | null) => Promise<void>

  /** renew対象（失効時刻 < beforeIso）を列挙する（store.listSubscriptionsToRenew） */
  listToRenew: (beforeIso: string) => Promise<GoogleChatSubscriptionToRenew[]>
  /** Google側の購読延命（client.renewChatSubscription） */
  renewSubscription: (resourceName: string) => Promise<{ expireTime: string | null }>

  /** orphan購読（対応するclaimed groupが無くなったactive購読）を列挙する（store.listOrphanedActiveSubscriptions） */
  listOrphaned: () => Promise<GoogleChatOrphanedSubscription[]>
  /** Google側の購読削除（client.deleteChatSubscription） */
  deleteSubscription: (resourceName: string) => Promise<void>

  /** 購読行を縮退させる（store.markSubscriptionStatus） */
  markSubscriptionStatus: (id: string, status: 'broken' | 'deleted', lastError?: string | null) => Promise<void>

  /** テスト注入用の現在時刻。省略時は `new Date()`（本番挙動）。 */
  now?: () => Date
}

export interface GoogleChatSubscriptionReconcilerSummary {
  created: number
  renewed: number
  broken: number
  deleted: number
}

/** renewの猶予: 失効24時間前から更新対象にする（cronの実行間隔=10分に対し十分な余裕）。 */
const RENEW_LEAD_TIME_MS = 24 * 60 * 60 * 1000

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function reconcileCreateMissing(
  deps: GoogleChatSubscriptionReconcilerDeps,
): Promise<{ created: number; broken: number }> {
  let created = 0
  let broken = 0
  const missing = await deps.listMissing()

  for (const group of missing) {
    try {
      const subscription = await deps.createSubscription(group.spaceName)

      let rowId: string
      try {
        const row = await deps.createSubscriptionRow({
          orgId: group.orgId,
          groupId: group.groupId,
          accountId: group.accountId,
          spaceName: group.spaceName,
        })
        rowId = row.id
      } catch (err) {
        // row作成失敗: Google側の購読は作成済みだが行が無い。次回reconcileでALREADY_EXISTS
        // 経由により回収される（createChatSubscriptionの冪等性に委ねる。ここではbrokenにしない）。
        console.error(
          '[google-chat-subscriptions] create-missing: row insert failed',
          group.groupId,
          toMessage(err),
        )
        continue
      }

      try {
        await deps.setSubscriptionResource(rowId, subscription.name, subscription.expireTime)
        created += 1
      } catch (err) {
        await deps.markSubscriptionStatus(rowId, 'broken', toMessage(err))
        broken += 1
      }
    } catch (err) {
      // Google側の購読作成自体が失敗（ALREADY_EXISTS未解決含む）: 行を作らず次回リトライに回す。
      console.error(
        '[google-chat-subscriptions] create-missing: subscription create failed',
        group.groupId,
        toMessage(err),
      )
    }
  }

  return { created, broken }
}

async function reconcileRenewExpiring(
  deps: GoogleChatSubscriptionReconcilerDeps,
  nowMs: number,
): Promise<{ renewed: number; broken: number }> {
  let renewed = 0
  let broken = 0
  const beforeIso = new Date(nowMs + RENEW_LEAD_TIME_MS).toISOString()
  const targets = await deps.listToRenew(beforeIso)

  for (const sub of targets) {
    // resource未確立(作成フェーズが行作成後に力尽きた等)の行はここでは扱わない。
    // 次回reconcileのcreate-missineには乗らない(既に行がある)ため放置に見えるが、
    // 実運用では create-missing のsetSubscriptionResource失敗時に既にbrokenへ縮退させている
    // ため、ここに到達するのは一時的な過渡状態のみ。
    if (!sub.subscriptionResourceName) continue

    try {
      const result = await deps.renewSubscription(sub.subscriptionResourceName)
      await deps.setSubscriptionResource(sub.id, sub.subscriptionResourceName, result.expireTime)
      renewed += 1
    } catch (err) {
      await deps.markSubscriptionStatus(sub.id, 'broken', toMessage(err))
      broken += 1
    }
  }

  return { renewed, broken }
}

async function reconcileDeleteOrphaned(
  deps: GoogleChatSubscriptionReconcilerDeps,
): Promise<{ deleted: number }> {
  let deleted = 0
  const orphaned = await deps.listOrphaned()

  for (const sub of orphaned) {
    try {
      if (sub.subscriptionResourceName) {
        await deps.deleteSubscription(sub.subscriptionResourceName)
      }
      await deps.markSubscriptionStatus(sub.id, 'deleted')
      deleted += 1
    } catch (err) {
      // Google側の削除に失敗: 行はactiveのまま残し次回リトライ（markSubscriptionStatusは呼ばない）。
      console.error('[google-chat-subscriptions] delete-orphaned failed', sub.id, toMessage(err))
    }
  }

  return { deleted }
}

/**
 * 1回の実行で create-missing → renew-expiring → delete-orphaned を冪等に回す。
 * 各フェーズ内の1件の失敗は他件の処理を止めない。
 */
export async function reconcileGoogleChatSubscriptions(
  deps: GoogleChatSubscriptionReconcilerDeps,
): Promise<GoogleChatSubscriptionReconcilerSummary> {
  const nowMs = (deps.now ?? (() => new Date()))().getTime()

  const { created, broken: brokenFromCreate } = await reconcileCreateMissing(deps)
  const { renewed, broken: brokenFromRenew } = await reconcileRenewExpiring(deps, nowMs)
  const { deleted } = await reconcileDeleteOrphaned(deps)

  return { created, renewed, broken: brokenFromCreate + brokenFromRenew, deleted }
}
