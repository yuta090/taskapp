import { describe, it, expect } from 'vitest'
import {
  FEATURE_CATALOG,
  PLAN_ORDER,
  PLAN_LABELS,
  buildPlanFeatureMatrix,
  planIdFromName,
} from '@/lib/billing/featureCatalog'

describe('FEATURE_CATALOG', () => {
  it('②③の2機能を label/description 付きで持つ', () => {
    const keys = FEATURE_CATALOG.map((f) => f.key)
    expect(keys).toEqual(
      expect.arrayContaining(['line_pickup_dual_mode', 'timed_line_reminders']),
    )
    for (const f of FEATURE_CATALOG) {
      expect(f.label.length).toBeGreaterThan(0)
      expect(f.description.length).toBeGreaterThan(0)
    }
  })
})

describe('PLAN_ORDER / PLAN_LABELS', () => {
  it('free→pro→enterprise の順で表示名を持つ', () => {
    expect(PLAN_ORDER).toEqual(['free', 'pro', 'enterprise'])
    expect(PLAN_LABELS.free).toBe('Free')
    expect(PLAN_LABELS.pro).toBe('Pro')
    expect(PLAN_LABELS.enterprise).toBe('Enterprise')
  })
})

describe('buildPlanFeatureMatrix', () => {
  it('free は全機能✗、pro/enterprise は全機能✓', () => {
    const matrix = buildPlanFeatureMatrix()
    expect(matrix).toHaveLength(FEATURE_CATALOG.length)
    for (const row of matrix) {
      expect(row.availability.free).toBe(false)
      expect(row.availability.pro).toBe(true)
      expect(row.availability.enterprise).toBe(true)
    }
  })
})

describe('planIdFromName', () => {
  it('表示名（大文字小文字問わず）を PlanId に写像する', () => {
    expect(planIdFromName('Free')).toBe('free')
    expect(planIdFromName('pro')).toBe('pro')
    expect(planIdFromName('ENTERPRISE')).toBe('enterprise')
  })

  it('未知/nullは free 扱い（fail-closed）', () => {
    expect(planIdFromName(null)).toBe('free')
    expect(planIdFromName('Business')).toBe('free')
  })
})
