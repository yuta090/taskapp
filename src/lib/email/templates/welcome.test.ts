import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { buildWelcomeEmailContent, WELCOME_PLACEHOLDERS, WELCOME_TEMPLATE_DEFAULTS } from './welcome'
import { placeholderToken } from './core'

const FIXTURES = path.join(__dirname, '__fixtures__')
const fixture = (name: string) => readFileSync(path.join(FIXTURES, name), 'utf8')

const base = { orgName: '株式会社サンプル', appName: 'AgentPM', appUrl: 'https://agentpm.app' }

/**
 * 回帰: 既定文面のようこそメールは __fixtures__/welcome.* と完全一致（共通化時 2026-09-07 に生成。
 * 旧版との差は冒頭2行の組み方だけ＝意図した変更）。文面を変えるときは見本も更新する。
 */
describe('buildWelcomeEmailContent — 既定文面は見本と完全一致', () => {
  it('welcome', () => {
    const out = buildWelcomeEmailContent(base)
    expect(out.subject).toBe(fixture('welcome.subject'))
    expect(out.html).toBe(fixture('welcome.html'))
    expect(out.text).toBe(fixture('welcome.txt'))
  })
})

describe('buildWelcomeEmailContent', () => {
  it('宣言した差し込み語は全部、実際の値に置き換わる（{{ が残らない）', () => {
    const body = WELCOME_PLACEHOLDERS.map(placeholderToken).join(' / ')
    const out = buildWelcomeEmailContent({ ...base, fields: { ...WELCOME_TEMPLATE_DEFAULTS, body } })
    expect(out.html).not.toContain('{{')
    expect(out.text).not.toContain('{{')
    expect(out.text).toContain('株式会社サンプル / AgentPM')
  })

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
