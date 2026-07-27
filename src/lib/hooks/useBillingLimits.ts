'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * 組織の使用状況（プロジェクト/メンバー/相手先/ストレージ）と、その上限。
 *
 * 真実源はサーバの `/api/billing/limits`（DBの `rpc_check_org_limits`）。
 * ここが値を返さないと「プランと請求」画面はプラン名を知れず、有料の組織にも
 * 「無料プランをご利用中です」と出てサブスクリプション管理ボタンが消える。
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
  const [limits, setLimits] = useState<BillingLimits | null>(null)
  // orgId が決まるまでは取りに行かない（組織の解決待ちで空振りさせない）
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!orgId) {
      setLimits(null)
      setError(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/billing/limits?org_id=${orgId}`, {
        credentials: 'same-origin',
      })
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown> & {
        error?: string
      }
      if (!res.ok) throw new Error(body.error ?? `使用状況を取得できませんでした (${res.status})`)

      setLimits({
        plan_name: typeof body.plan_name === 'string' ? body.plan_name : undefined,
        projects_used: toNumber(body.projects_used),
        projects_limit: toLimit(body.projects_limit),
        members_used: toNumber(body.members_used),
        members_limit: toLimit(body.members_limit),
        clients_used: toNumber(body.clients_used),
        clients_limit: toLimit(body.clients_limit),
        storage_used_bytes: toNumber(body.storage_used_bytes),
        storage_limit_bytes: toLimit(body.storage_limit_bytes),
      })
    } catch (e) {
      setLimits(null)
      setError(e instanceof Error ? e.message : '使用状況を取得できませんでした')
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    void load()
  }, [load])

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

  return { limits, loading, error, refresh: load, isAtLimit, getRemainingCount }
}
