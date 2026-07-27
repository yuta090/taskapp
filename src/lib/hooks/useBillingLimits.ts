'use client'

import { useCallback } from 'react'
import { useBillingLimitsQuery } from './useBillingLimitsQuery'

/**
 * 組織の使用状況（プロジェクト/メンバー/相手先/ストレージ）と、その上限。
 *
 * 真実源はサーバの `/api/billing/limits`（DBの `rpc_check_org_limits`）。
 * ここが値を返さないと「プランと請求」画面はプラン名を知れず、有料の組織にも
 * 「無料プランをご利用中です」と出てサブスクリプション管理ボタンが消える。
 *
 * 取得は `useBillingLimitsQuery`（react-query）に集約。同じ画面の
 * `useEntitlements` と同一 queryKey なので、同時に走っても実際の通信は1本。
 *
 * 上限 `null` は無制限（Enterprise など）。判定は「未取得＝制限なし扱い」に倒す
 * ＝読めていないことを理由に操作を止めない（止めるのはサーバ側の作成境界の仕事）。
 */

export type BillingLimitType = 'projects' | 'members' | 'clients' | 'storage'

export interface BillingLimits {
  plan_name?: string
  projects_used: number
  projects_limit: number | null
  members_used: number
  members_limit: number | null
  clients_used: number
  clients_limit: number | null
  storage_used_bytes: number
  storage_limit_bytes: number | null
}

const USED_KEY: Record<BillingLimitType, keyof BillingLimits> = {
  projects: 'projects_used',
  members: 'members_used',
  clients: 'clients_used',
  storage: 'storage_used_bytes',
}

const LIMIT_KEY: Record<BillingLimitType, keyof BillingLimits> = {
  projects: 'projects_limit',
  members: 'members_limit',
  clients: 'clients_limit',
  storage: 'storage_limit_bytes',
}

function toNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function toLimit(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function useBillingLimits(orgId?: string) {
  // orgId が決まるまでは取りに行かない（組織の解決待ちで空振りさせない）
  const { data, isPending, error, refetch } = useBillingLimitsQuery(orgId, !!orgId)

  const limits: BillingLimits | null =
    !orgId || !data
      ? null
      : {
          plan_name: typeof data.plan_name === 'string' ? data.plan_name : undefined,
          projects_used: toNumber(data.projects_used),
          projects_limit: toLimit(data.projects_limit),
          members_used: toNumber(data.members_used),
          members_limit: toLimit(data.members_limit),
          clients_used: toNumber(data.clients_used),
          clients_limit: toLimit(data.clients_limit),
          storage_used_bytes: toNumber(data.storage_used_bytes),
          storage_limit_bytes: toLimit(data.storage_limit_bytes),
        }

  const isAtLimit = useCallback(
    (type: BillingLimitType | string) => {
      if (!limits) return false
      const key = type as BillingLimitType
      if (!(key in LIMIT_KEY)) return false
      const limit = limits[LIMIT_KEY[key]] as number | null
      if (limit === null) return false // 無制限
      const used = limits[USED_KEY[key]] as number
      return used >= limit
    },
    [limits],
  )

  /** 残り枠。無制限・未取得は null（＝警告を出さない）。 */
  const getRemainingCount = useCallback(
    (type: BillingLimitType | string): number | null => {
      if (!limits) return null
      const key = type as BillingLimitType
      if (!(key in LIMIT_KEY)) return null
      const limit = limits[LIMIT_KEY[key]] as number | null
      if (limit === null) return null
      const used = limits[USED_KEY[key]] as number
      return Math.max(0, limit - used)
    },
    [limits],
  )

  const refresh = useCallback(async () => {
    if (!orgId) return
    await refetch()
  }, [orgId, refetch])

  return {
    limits,
    // キャッシュに在庫があればスケルトンを出さない（再訪で毎回真っ白にしない）
    loading: !!orgId && isPending && !data,
    error: error instanceof Error ? error.message : null,
    refresh,
    isAtLimit,
    getRemainingCount,
  }
}
