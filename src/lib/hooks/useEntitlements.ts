'use client'

import { useCallback } from 'react'
import type { Feature } from '@/lib/billing/entitlements'
import { useBillingLimitsQuery } from './useBillingLimitsQuery'

/**
 * クライアント側のエンタイトルメント表示用フック（④ 課金導線）。
 * /api/billing/limits の features（表示専用）を読み、has(feature) を返す。
 *
 * 取得は `useBillingLimitsQuery`（react-query）に集約。使用状況カードの
 * `useBillingLimits` と同一 queryKey なので、同じ画面に両方あっても通信は1本。
 *
 * ※これは**表示専用**（アップグレード導線の出し分けに使う）。実際の機能ゲートは
 * サーバ（設定API=403／cron送信時=fail-closed）が真実源。クライアント判定は
 * 迂回可能なので信頼しない。取得失敗・ロード中は has=false（fail-closed）で、
 * 「利用可否が不明なら控えめに＝誤って解禁UIを見せない」側に倒す。
 */
export interface UseEntitlementsResult {
  features: Feature[]
  has: (feature: Feature) => boolean
  planName: string | null
  loading: boolean
  error: string | null
  refresh: () => void
}

export function useEntitlements(orgId?: string): UseEntitlementsResult {
  // orgId 未指定でも問い合わせる（サーバが cookie から組織を解決する既存挙動を維持）。
  const { data, isPending, error, refetch } = useBillingLimitsQuery(orgId)

  // fail-closed: 失敗・未取得は「機能なし」扱い
  const features: Feature[] = Array.isArray(data?.features) ? (data.features as Feature[]) : []
  const planName = typeof data?.plan_name === 'string' ? data.plan_name : null

  const has = useCallback((feature: Feature) => features.includes(feature), [features])
  const refresh = useCallback(() => {
    void refetch()
  }, [refetch])

  return {
    features,
    has,
    planName,
    loading: isPending && !data,
    error: error instanceof Error ? error.message : null,
    refresh,
  }
}
