import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// stripe モジュールは env 非依存でモック。
// enterprise にも priceId を設定しておき、「設定済みでも enterprise は sales-led で拒否」を証明する。
const sessionCreate = vi.fn(async () => ({ id: 'cs_test', url: 'https://checkout.example/cs_test' }))
vi.mock('@/lib/stripe', () => ({
  getStripe: vi.fn(() => ({ checkout: { sessions: { create: sessionCreate } } })),
  PLANS: {
    free: { priceId: null },
    pro: { priceId: 'price_pro_test' },
    enterprise: { priceId: 'price_ent_test' },
  },
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { POST } from '@/app/api/stripe/checkout/route'
import { createClient } from '@/lib/supabase/server'

function makeSupabase(opts: {
  user: { id: string; email: string } | null
  membershipRole?: string | null
  billingRow?: { stripe_customer_id: string | null } | null
}): SupabaseClient {
  const auth = { getUser: vi.fn(async () => ({ data: { user: opts.user }, error: null })) }
  const from = vi.fn((table: string) => {
    const single = vi.fn(async () => {
      if (table === 'org_memberships') {
        return { data: opts.membershipRole ? { role: opts.membershipRole } : null, error: null }
      }
      if (table === 'org_billing') return { data: opts.billingRow ?? null, error: null }
      return { data: null, error: null }
    })
    const builder: Record<string, unknown> = {}
    builder.select = vi.fn(() => builder)
    builder.eq = vi.fn(() => builder)
    builder.single = single
    return builder
  })
  return { auth, from } as unknown as SupabaseClient
}

function req(body: unknown): Request {
  return new Request('http://localhost/api/stripe/checkout', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('POST /api/stripe/checkout — Enterprise は sales-led で拒否', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('enterprise は priceId が設定済みでも 400 で拒否し、Stripe を呼ばない', async () => {
    vi.mocked(createClient).mockResolvedValue(
      makeSupabase({ user: { id: 'u1', email: 'a@example.com' }, membershipRole: 'owner' })
    )

    const res = await POST(req({ org_id: 'org-1', plan_id: 'enterprise' }) as never)
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.code).toBe('enterprise_contact_sales')
    expect(sessionCreate).not.toHaveBeenCalled()
  })

  it('pro は従来どおり checkout セッションを作成できる（guard に巻き込まれない）', async () => {
    vi.mocked(createClient).mockResolvedValue(
      makeSupabase({
        user: { id: 'u1', email: 'a@example.com' },
        membershipRole: 'owner',
        billingRow: { stripe_customer_id: null },
      })
    )

    const res = await POST(req({ org_id: 'org-1', plan_id: 'pro' }) as never)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.url).toContain('checkout.example')
    expect(sessionCreate).toHaveBeenCalledTimes(1)
  })

  it('未ログインは 401（guard より前に認証が効く）', async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabase({ user: null }))

    const res = await POST(req({ org_id: 'org-1', plan_id: 'enterprise' }) as never)
    expect(res.status).toBe(401)
  })
})
