import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PLAN_LIMITS, type PlanId } from '@/lib/billing/entitlements'

/**
 * 数量上限は 2箇所に現れる:
 *   - TS: PLAN_LIMITS（アプリ側の判定・表示）
 *   - SQL: plans テーブル（rpc_check_org_limits 経由で **招待の作成/受諾で実際に執行**される）
 * 片方だけ変えると「画面は30名と言うのにDBは20名で断る」静かな乖離が起きる。
 * ここで両者の一致を回帰で固定する（org_push_quota のパリティテストと同じ約束）。
 */
describe('plans テーブル ⇄ PLAN_LIMITS parity', () => {
  const migration = readFileSync(
    join(process.cwd(), 'supabase/migrations/20260726143218_plan_seats_and_project_limits.sql'),
    'utf8',
  )

  /** `update plans set projects_limit = X, members_limit = Y, clients_limit = Z where id = 'plan';` */
  function seeded(plan: PlanId): {
    projects: number | null
    members: number | null
    clients: number | null
  } {
    const re = new RegExp(
      String.raw`update plans set projects_limit = (\d+|null),\s*members_limit = (\d+|null),\s*clients_limit = (\d+|null) where id = '${plan}';`,
    )
    const m = migration.match(re)
    expect(m, `${plan} の update 文が見つからない`).not.toBeNull()
    const num = (s: string) => (s === 'null' ? null : Number(s))
    return { projects: num(m![1]), members: num(m![2]), clients: num(m![3]) }
  }

  it.each<PlanId>(['free', 'pro', 'enterprise'])(
    '%s の projects/members/clients が TS と SQL で一致する',
    (plan) => {
      const sql = seeded(plan)
      expect(sql.projects).toBe(PLAN_LIMITS[plan].maxProjects)
      expect(sql.members).toBe(PLAN_LIMITS[plan].maxMembers)
      expect(sql.clients).toBe(PLAN_LIMITS[plan].maxClientUsers)
    },
  )

  it('内部メンバーはプランを上げると増える階段（free < pro < 無制限）', () => {
    expect(PLAN_LIMITS.free.maxMembers).toBe(5)
    expect(PLAN_LIMITS.pro.maxMembers).toBe(30)
    expect(PLAN_LIMITS.enterprise.maxMembers).toBeNull()
  })

  it('相手先ユーザーは全プラン無制限（相手を招くほど高くなる形にしない）', () => {
    expect(PLAN_LIMITS.free.maxClientUsers).toBeNull()
    expect(PLAN_LIMITS.pro.maxClientUsers).toBeNull()
    expect(PLAN_LIMITS.enterprise.maxClientUsers).toBeNull()
  })
})
