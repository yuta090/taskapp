'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Feature } from '@/lib/billing/entitlements'

/**
 * クライアント側のエンタイトルメント表示用フック（④ 課金導線）。
 * /api/billing/limits の features（表示専用）を読み、has(feature) を返す。
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
  const [features, setFeatures] = useState<Feature[]>([])
  const [planName, setPlanName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchEntitlements = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError(null)

    const url = orgId
      ? `/api/billing/limits?org_id=${encodeURIComponent(orgId)}`
      : '/api/billing/limits'

    try {
      const res = await fetch(url, { signal })
      if (signal?.aborted) return
      if (!res.ok) throw new Error(`billing/limits ${res.status}`)
      const json = (await res.json()) as { features?: unknown; plan_name?: unknown }
      setFeatures(Array.isArray(json.features) ? (json.features as Feature[]) : [])
      setPlanName(typeof json.plan_name === 'string' ? json.plan_name : null)
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      if (signal?.aborted) return
      // fail-closed: 不明なら機能なし扱い
      setFeatures([])
      setPlanName(null)
      setError(err instanceof Error ? err.message : 'failed')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    const controller = new AbortController()
    fetchEntitlements(controller.signal)
    return () => controller.abort()
  }, [fetchEntitlements])

  const has = useCallback((feature: Feature) => features.includes(feature), [features])
  const refresh = useCallback(() => {
    fetchEntitlements()
  }, [fetchEntitlements])

  return { features, has, planName, loading, error, refresh }
}
