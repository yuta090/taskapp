import { createAdminClient } from '@/lib/supabase/admin'
import BillingPageClient, { type BillingRow } from './BillingPageClient'

interface OrgRow { id: string; name: string }
interface PlanRow { id: string; name: string; projects_limit: number | null; members_limit: number | null; is_active: boolean }

async function fetchBillingData(): Promise<BillingRow[]> {
  const admin = createAdminClient()

  const [billingsResult, plansResult, orgsResult] = await Promise.all([
    admin.from('org_billing').select('org_id, plan_id, status, stripe_customer_id, stripe_subscription_id, current_period_end, cancel_at_period_end, created_at'),
    admin.from('plans').select('id, name, projects_limit, members_limit, is_active'),
    admin.from('organizations').select('id, name'),
  ])

  if (billingsResult.error) console.error('[admin/billing] org_billing query error:', billingsResult.error.message)
  if (plansResult.error) console.error('[admin/billing] plans query error:', plansResult.error.message)
  if (orgsResult.error) console.error('[admin/billing] organizations query error:', orgsResult.error.message)

  const orgMap = new Map<string, string>()
  ;((orgsResult.data as OrgRow[] | null) ?? []).forEach((o) => orgMap.set(o.id, o.name))

  const planMap = new Map<string, string>()
  ;((plansResult.data as PlanRow[] | null) ?? []).forEach((p) => planMap.set(p.id, p.name))

  return ((billingsResult.data as Array<{
    org_id: string
    plan_id: string
    status: string
    stripe_customer_id: string | null
    stripe_subscription_id: string | null
    current_period_end: string | null
    cancel_at_period_end: boolean
    created_at: string
  }>) ?? []).map((b) => ({
    ...b,
    orgName: orgMap.get(b.org_id) ?? b.org_id.slice(0, 8),
    planName: planMap.get(b.plan_id) ?? b.plan_id,
  }))
}

export default async function AdminBillingPage() {
  const rows = await fetchBillingData()
  return <BillingPageClient initialData={rows} />
}
