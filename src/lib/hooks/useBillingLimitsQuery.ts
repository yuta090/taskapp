'use client'

import { useQuery } from '@tanstack/react-query'

/**
 * `/api/billing/limits` の生レスポンスを1本のクエリに集約する土台。
 *
 * 「プランと請求」画面では使用状況カード・プラン別機能一覧・プラン名の3か所が
 * **同じAPI**を必要とする。それぞれが素の fetch を持つと同じ答えを3回作りに行き、
 * サーバ側は1回あたり「本人確認 → 所属確認 → 件数集計 → プラン確定」と往復する。
 * react-query の同一 queryKey に寄せると、同時に走った分は自動で1本にまとまり、
 * 2回目以降の来訪はキャッシュから即描画される（毎回スケルトンにしない）。
 *
 * ⚠ ここは**表示専用**。実際の機能ゲート・上限の執行はサーバが真実源で、
 * クライアントの値は迂回できるので判定に使わない。
 */

export interface BillingLimitsResponse {
  plan_name?: unknown
  features?: unknown
  projects_used?: unknown
  projects_limit?: unknown
  members_used?: unknown
  members_limit?: unknown
  clients_used?: unknown
  clients_limit?: unknown
  storage_used_bytes?: unknown
  storage_limit_bytes?: unknown
}

/** orgId ごとに1本。未確定（undefined）は null に正規化して別枠にする。 */
export function billingLimitsQueryKey(orgId?: string) {
  return ['billingLimits', orgId ?? null] as const
}

export function useBillingLimitsQuery(orgId: string | undefined, enabled = true) {
  return useQuery<BillingLimitsResponse>({
    queryKey: billingLimitsQueryKey(orgId),
    queryFn: async () => {
      const url = orgId
        ? `/api/billing/limits?org_id=${encodeURIComponent(orgId)}`
        : '/api/billing/limits'
      const res = await fetch(url, { credentials: 'same-origin' })
      const json = (await res.json().catch(() => ({}))) as BillingLimitsResponse & {
        error?: string
      }
      if (!res.ok) {
        throw new Error(
          typeof json.error === 'string'
            ? json.error
            : `使用状況を取得できませんでした (${res.status})`,
        )
      }
      return json
    },
    enabled,
    // 使用状況の数字は秒単位の鮮度を必要としない（QueryProvider の既定と同じ2分）。
    staleTime: 2 * 60_000,
  })
}
