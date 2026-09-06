/**
 * 差出人表示名「{事務所名} (AgentPM)」に載せる事務所名を決める（server 専用）。
 *
 * 判断（Fable 2026-09-07）: 事務所名の名乗りは **有料プランの事務所だけ**。
 * 無料登録は誰でも組織名を自由に付けられるので、当社の認証済みドメインから
 * 「〇〇銀行 (AgentPM)」のようななりすましメールが作れてしまう（1件の悪用で全事務所の到達率が落ちる）。
 * 支払いで身元が担保される有料プランに限る（「自社の名前で届く」が Pro の売りである点とも一致）。
 * 無料プランは表示名「AgentPM」のみ。
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export function isPaidPlanId(planId: string | null | undefined): boolean {
  return !!planId && planId !== 'free'
}

/** 複数の org について、表示名に載せてよい名前を返す（有料でない org は含まれない） */
export async function resolveSenderOrgNames(admin: SupabaseClient, orgIds: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const ids = [...new Set(orgIds.filter(Boolean))]
  if (ids.length === 0) return out
  try {
    const [{ data: orgs }, { data: billing }] = await Promise.all([
      admin.from('organizations').select('id, name').in('id', ids),
      admin.from('org_billing').select('org_id, plan_id').in('org_id', ids),
    ])
    const paid = new Set(((billing ?? []) as Array<{ org_id: string; plan_id: string | null }>).filter((b) => isPaidPlanId(b.plan_id)).map((b) => b.org_id))
    for (const o of (orgs ?? []) as Array<{ id: string; name: string | null }>) {
      if (paid.has(o.id) && o.name) out.set(o.id, o.name)
    }
  } catch (err) {
    // 取れなければ名乗らない（AgentPM のみ）
    console.error('resolveSenderOrgNames failed', err)
  }
  return out
}

export async function resolveSenderOrgName(admin: SupabaseClient, orgId: string): Promise<string | null> {
  const m = await resolveSenderOrgNames(admin, [orgId])
  return m.get(orgId) ?? null
}
