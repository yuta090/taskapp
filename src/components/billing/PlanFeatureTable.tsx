'use client'

import { Check, Minus } from '@phosphor-icons/react'
import { useEntitlements } from '@/lib/hooks/useEntitlements'
import {
  buildPlanFeatureMatrix,
  planIdFromName,
  PLAN_ORDER,
  PLAN_LABELS,
} from '@/lib/billing/featureCatalog'
import type { PlanId } from '@/lib/billing/entitlements'

/**
 * プラン別の有料機能一覧（②③の可否を Free/Pro/Enterprise 横断で表示）。
 *
 * 可否の真実源は PLAN_FEATURES（buildPlanFeatureMatrix 経由）。現在プランは
 * useEntitlements の planName から解決してハイライトする（表示専用・fail-closed）。
 * このコンポーネント自体はゲートしない（機能ゲートはサーバ側が担う）。純粋に
 * 「どのプランで何が使えるか」を見せ、未解禁機能へのアップグレード動機付けにする。
 */
export function PlanFeatureTable({ orgId }: { orgId?: string }) {
  const { planName, loading } = useEntitlements(orgId)
  const currentPlan: PlanId = planIdFromName(planName)
  const matrix = buildPlanFeatureMatrix()

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h3 className="text-lg font-semibold text-gray-900">プラン別の機能</h3>
      <p className="mt-1 text-sm text-gray-500">
        Pro 以上で使える機能の一覧です。現在のプランはハイライトされています。
      </p>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[28rem] text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left">
              <th className="py-2 pr-4 font-medium text-gray-500">機能</th>
              {PLAN_ORDER.map((plan) => {
                const isCurrent = !loading && plan === currentPlan
                return (
                  <th
                    key={plan}
                    className={`px-3 py-2 text-center font-semibold ${
                      isCurrent ? 'text-indigo-600' : 'text-gray-700'
                    }`}
                  >
                    {PLAN_LABELS[plan]}
                    {isCurrent && (
                      <span className="ml-1 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600 align-middle">
                        現在
                      </span>
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {matrix.map(({ feature, availability }) => (
              <tr key={feature.key} className="border-b border-gray-100 last:border-0">
                <td className="py-3 pr-4">
                  <p className="font-medium text-gray-900">{feature.label}</p>
                  <p className="mt-0.5 text-xs text-gray-500">{feature.description}</p>
                </td>
                {PLAN_ORDER.map((plan) => {
                  const isCurrent = !loading && plan === currentPlan
                  return (
                    <td
                      key={plan}
                      className={`px-3 py-3 text-center ${isCurrent ? 'bg-indigo-50/50' : ''}`}
                    >
                      {availability[plan] ? (
                        <Check
                          weight="bold"
                          className="mx-auto h-4 w-4 text-green-600"
                          aria-label="利用可能"
                        />
                      ) : (
                        <Minus className="mx-auto h-4 w-4 text-gray-300" aria-label="利用不可" />
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
