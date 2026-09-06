import { describe, it, expect } from 'vitest'
import { buildWelcomeEmailContent, WELCOME_TEMPLATE_DEFAULTS } from './welcome'

const base = { orgName: '株式会社サンプル', appName: 'AgentPM', appUrl: 'https://agentpm.app' }

describe('buildWelcomeEmailContent', () => {
  it('既定文面: 従来の件名・見出し・手順・ログイン導線・ヘルプ案内が両形式に出る', () => {
    const out = buildWelcomeEmailContent(base)
    expect(out.subject).toBe('【AgentPM】ようこそ！最初の3ステップ + LINE秘書連携')
    expect(out.html).toContain('ようこそ、株式会社サンプル 様')
    expect(out.html).toContain('① 最初のタスクを作成')
    expect(out.html).toContain('追加だけでは連携されません')
    expect(out.html).toContain('href="https://agentpm.app/login"')
    expect(out.html).toContain('>AgentPM にログイン</a>')
    expect(out.html).toContain('href="https://agentpm.app/help"')
    expect(out.text).toContain('AgentPM - ようこそ、株式会社サンプル 様')
    expect(out.text).toContain('① 最初のタスクを作成\nタイトルを入力してEnterを押すだけで作成できます。')
    expect(out.text).toContain('AgentPM にログイン:\nhttps://agentpm.app/login')
    expect(out.text).toContain('ヘルプページをご覧ください:\nhttps://agentpm.app/help')
  })

  it('組織名の HTML はエスケープされる', () => {
    const out = buildWelcomeEmailContent({ ...base, orgName: '<script>alert(1)</script>' })
    expect(out.html).not.toContain('<script>')
    expect(out.html).toContain('&lt;script&gt;')
  })

  it('保存された文面(fields)を渡すとそれで描き、手順表はコード固定のまま残る', () => {
    const out = buildWelcomeEmailContent({
      ...base,
      fields: { ...WELCOME_TEMPLATE_DEFAULTS, subject: '独自件名 {{組織名}}', heading: '独自見出し', body: '独自本文', cta_label: '入る', note: '補足' },
    })
    expect(out.subject).toBe('独自件名 株式会社サンプル')
    expect(out.html).toContain('独自見出し')
    expect(out.html).toContain('>入る</a>')
    expect(out.html).toContain('補足')
    expect(out.html).toContain('④ LINE秘書と連携')
    expect(out.text).toContain('② メンバー・クライアントを招待')
  })
})
