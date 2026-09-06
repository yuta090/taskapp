import { describe, it, expect } from 'vitest'
import { CAP_TEMPLATE_DEFAULTS, nextMonthResetLabel, renderCapReachedEmail } from './capReached'

const vars = { orgName: '<株式会社サンプル>', limitLabel: '50', resetDateLabel: '2026年10月1日', appName: 'AgentPM' }

describe('cap reached templates', () => {
  it('無料枠: 件名・見出し・本文・ボタンに差し込まれ、組織名はエスケープされる', () => {
    const out = renderCapReachedEmail({ key: 'free_cap_upgrade', fields: CAP_TEMPLATE_DEFAULTS.free_cap_upgrade, vars, ctaUrl: 'https://agentpm.app/settings/billing' })
    expect(out.subject).toBe('【AgentPM】今月の無料通知枠に達しました（Proで送信枠拡大・即時通知）')
    expect(out.html).toContain('今月の無料通知枠（50通）に達しました')
    expect(out.html).toContain('&lt;株式会社サンプル&gt; の共通LINE自動通知が、今月の上限（50通）に達しました。以降の自動通知は2026年10月1日まで停止します。')
    expect(out.html).toContain('・自社LINE（事務所名で相手先に届く・白ラベル）')
    expect(out.html).toContain('>プランを確認する</a>')
    expect(out.html).toContain('href="https://agentpm.app/settings/billing"')
    expect(out.html).toContain('#4f46e5')
    expect(out.text).toContain('プランを確認する:\nhttps://agentpm.app/settings/billing')
  })

  it('プールAI: 補足にリセット日が入る', () => {
    const out = renderCapReachedEmail({ key: 'pool_ai_exhausted', fields: CAP_TEMPLATE_DEFAULTS.pool_ai_exhausted, vars, ctaUrl: 'https://agentpm.app/settings/org-integrations' })
    expect(out.subject).toContain('プールAIの今月の上限に達しました')
    expect(out.html).toContain('チャットからの自動タスク抽出が一時的に停止しています')
    expect(out.html).toContain('※ 登録しない場合も、2026年10月1日には自動的に上限がリセットされ再開します。')
    expect(out.html).toContain('>AIキーを登録する</a>')
    // プールAIのテンプレでは {{上限数}} は使えない → 置換されず残る（validate で弾く前提）
    const raw = renderCapReachedEmail({ key: 'pool_ai_exhausted', fields: { ...CAP_TEMPLATE_DEFAULTS.pool_ai_exhausted, body: '{{上限数}}' }, vars, ctaUrl: 'x' })
    expect(raw.text).toContain('{{上限数}}')
  })

  it('nextMonthResetLabel は翌月1日（年またぎも）', () => {
    expect(nextMonthResetLabel(new Date(2026, 8, 7))).toBe('2026年10月1日')
    expect(nextMonthResetLabel(new Date(2026, 11, 31))).toBe('2027年1月1日')
  })
})
