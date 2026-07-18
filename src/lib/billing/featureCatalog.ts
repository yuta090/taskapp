import type { Feature, PlanId } from './entitlements'
import { PLAN_FEATURES } from './entitlements'

/**
 * 有料機能の表示カタログ（設定ページのプラン別機能一覧・②③の可否表示用）。
 *
 * 機能の**可否そのもの**は entitlements.ts の PLAN_FEATURES を唯一の真実源にする
 * （ここには可否を持たせず、表示用の label/description だけを足す）。
 * これにより「表で✓なのに実際は使えない」等の乖離が構造的に起きない。
 */
export interface FeatureMeta {
  key: Feature
  label: string
  description: string
}

export const FEATURE_CATALOG: readonly FeatureMeta[] = [
  {
    key: 'line_pickup_dual_mode',
    label: 'LINE両方取り込み',
    description: '毎時まとめ抽出とメンション即時タスク化を同時に有効化',
  },
  {
    key: 'timed_line_reminders',
    label: '時刻指定リマインド',
    description: '指定した日時に、顧問先のLINEグループへ秘書が自動リマインド',
  },
]

export const PLAN_ORDER: readonly PlanId[] = ['free', 'pro', 'enterprise']

export const PLAN_LABELS: Record<PlanId, string> = {
  free: 'Free',
  pro: 'Pro',
  enterprise: 'Enterprise',
}

export interface PlanFeatureRow {
  feature: FeatureMeta
  availability: Record<PlanId, boolean>
}

/**
 * 「機能 × プラン」の可否マトリクスを PLAN_FEATURES から機械的に構築する（純関数）。
 */
export function buildPlanFeatureMatrix(): PlanFeatureRow[] {
  return FEATURE_CATALOG.map((feature) => ({
    feature,
    availability: {
      free: PLAN_FEATURES.free.has(feature.key),
      pro: PLAN_FEATURES.pro.has(feature.key),
      enterprise: PLAN_FEATURES.enterprise.has(feature.key),
    },
  }))
}

/**
 * 表示名（'Free'/'Pro'/'Enterprise' 等・大文字小文字は不問）を PlanId に写像する。
 * 未知の名称や null は free 扱い（fail-closed：現行プランのハイライトを過大表示しない）。
 */
export function planIdFromName(name: string | null | undefined): PlanId {
  const normalized = (name ?? '').trim().toLowerCase()
  if (normalized === 'pro') return 'pro'
  if (normalized === 'enterprise') return 'enterprise'
  return 'free'
}
