import { describe, it, expect } from 'vitest'
import { PLAN_FEATURES, planHasFeature } from '@/lib/billing/entitlements'
import { MODEL_PRICES } from '@/lib/ai/cost'

/**
 * pooled_ai_key（プールAI鍵）は Pro 専有。Free は絶対に持たない（fail-closed の入口）。
 */
describe('pooled_ai_key entitlement', () => {
  it('free は pooled_ai_key を持たない', () => {
    expect(PLAN_FEATURES.free.has('pooled_ai_key')).toBe(false)
    expect(planHasFeature('free', 'pooled_ai_key')).toBe(false)
  })

  it('pro / enterprise は pooled_ai_key を持つ', () => {
    expect(planHasFeature('pro', 'pooled_ai_key')).toBe(true)
    expect(planHasFeature('enterprise', 'pooled_ai_key')).toBe(true)
  })
})

describe('プール既定モデルは MODEL_PRICES に存在する（cap判定に単価が要る）', () => {
  it('PLATFORM_AI_MODEL の既定 gpt-4o-mini が価格表にある', () => {
    // env未設定時の getPlatformAiConfig 既定は gpt-4o-mini。cost.ts に単価が無いと cap 判定が成立しない。
    expect(MODEL_PRICES['gpt-4o-mini']).toBeDefined()
  })
})
