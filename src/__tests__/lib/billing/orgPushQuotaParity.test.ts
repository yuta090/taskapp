import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PLAN_LIMITS } from '@/lib/billing/entitlements'

/**
 * 共通LINE org別クォータの値は 2箇所に現れる:
 *   - TS: PLAN_LIMITS.free.monthlySharedPushQuota（送信境界の判定・UI表示）
 *   - SQL: 20260720201858_org_push_quota_from_plan.sql の app_org_push_quota()（実際に quota を書く）
 * 片方だけ変えると「50で throttle してるつもりが DB は 40」のような静かな乖離が起きる。
 * ここで両者の一致を回帰で固定する（SQL 側は定数 c_free_quota をマーカ付きで grep する）。
 */
describe('org_push_quota SQL ⇄ PLAN_LIMITS parity', () => {
  const migration = readFileSync(
    join(process.cwd(), 'supabase/migrations/20260720201858_org_push_quota_from_plan.sql'),
    'utf8',
  )

  it('SQLの free クォータ定数が PLAN_LIMITS.free.monthlySharedPushQuota と一致する', () => {
    const m = migration.match(/c_free_quota constant int := (\d+)/)
    expect(m).not.toBeNull()
    expect(Number(m![1])).toBe(PLAN_LIMITS.free.monthlySharedPushQuota)
  })

  it('pro/enterprise は無制限(null)＝SQLがNULLを返す前提を固定する', () => {
    expect(PLAN_LIMITS.pro.monthlySharedPushQuota).toBeNull()
    expect(PLAN_LIMITS.enterprise.monthlySharedPushQuota).toBeNull()
  })
})
