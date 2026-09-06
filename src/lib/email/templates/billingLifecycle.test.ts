import { describe, it, expect } from 'vitest'
import { BILLING_PLACEHOLDERS, BILLING_TEMPLATE_DEFAULTS, BILLING_TEMPLATE_KEYS, formatJstDateLabel, renderBillingLifecycleEmail } from './billingLifecycle'

const vars = { orgName: '<株式会社サンプル>', planLabel: 'Pro', nextBillingDateLabel: '2026年10月7日', appName: 'AgentPM' }

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

  it('差し込み語は 組織名・プラン名・次回請求日・サービス名', () => {
    expect(BILLING_PLACEHOLDERS.map((p) => p.name)).toEqual(['組織名', 'プラン名', '次回請求日', 'サービス名'])
  })

  it('formatJstDateLabel は JST の日付（UTC 前日の夜でも日本の日付）', () => {
    // 2026-10-06T16:00:00Z = 2026-10-07 01:00 JST
    expect(formatJstDateLabel(Date.UTC(2026, 9, 6, 16, 0, 0) / 1000)).toBe('2026年10月7日')
    expect(formatJstDateLabel(null)).toBe('')
    expect(formatJstDateLabel(0)).toBe('')
  })
})
