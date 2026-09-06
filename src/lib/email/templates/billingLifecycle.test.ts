import { describe, it, expect } from 'vitest'
import { BILLING_PLACEHOLDERS, BILLING_TEMPLATE_DEFAULTS, BILLING_TEMPLATE_KEYS, renderBillingLifecycleEmail } from './billingLifecycle'

const vars = { orgName: '<株式会社サンプル>', planLabel: 'Pro', appName: 'AgentPM' }

describe('billing lifecycle templates', () => {
  it('3通とも既定文面で差し込み済みに描け、組織名はエスケープされる', () => {
    for (const key of BILLING_TEMPLATE_KEYS) {
      const out = renderBillingLifecycleEmail({ key, fields: BILLING_TEMPLATE_DEFAULTS[key], vars, ctaUrl: 'https://agentpm.app/settings/billing' })
      expect(out.html).not.toContain('{{')
      expect(out.html).toContain('&lt;株式会社サンプル&gt;')
      expect(out.html).toContain('href="https://agentpm.app/settings/billing"')
    }
    expect(renderBillingLifecycleEmail({ key: 'billing_payment_failed', fields: BILLING_TEMPLATE_DEFAULTS.billing_payment_failed, vars, ctaUrl: 'x' }).subject)
      .toBe('【AgentPM】お支払いが確認できませんでした（Pro プラン）')
    expect(renderBillingLifecycleEmail({ key: 'billing_activated', fields: BILLING_TEMPLATE_DEFAULTS.billing_activated, vars, ctaUrl: 'x' }).html).toContain('>料金プランを確認する</a>')
  })

  it('差し込み語は 組織名・プラン名・サービス名（次回請求日は経路により値が無いので持たない）', () => {
    expect(BILLING_PLACEHOLDERS.map((p) => p.name)).toEqual(['組織名', 'プラン名', 'サービス名'])
  })

  it('支払い失敗の補足に「組織オーナーのみ」が入る（admin が押しても手詰まりにならないよう）', () => {
    expect(BILLING_TEMPLATE_DEFAULTS.billing_payment_failed.note).toContain('組織オーナーのみ')
  })
})
