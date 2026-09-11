import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { INVITE_TEMPLATE_DEFAULTS, INVITE_PLACEHOLDERS, inviteVarsByName, renderInviteEmail, type InviteTemplateVars } from './invite'

const vars: InviteTemplateVars = {
  inviterName: '山田 太郎',
  orgName: '株式会社サンプル',
  spaceName: 'ホームページ制作',
  expiresDate: '2026年9月14日',
  appName: 'AgentPM',
}

const FIXTURES = path.join(__dirname, '__fixtures__')
const fixture = (name: string) => readFileSync(path.join(FIXTURES, name), 'utf8')

/**
 * 回帰: 既定文面で送る招待メールは、共通化（core.ts）前の出力と1バイトも変わらないこと。
 * 見本は 2026-09-07 の本番コードから生成した（__fixtures__）。
 */
describe('renderInviteEmail — 既定文面は共通化前と完全一致', () => {
  const cases = [
    ['client', 'invite_client', 'https://agentpm.app/invite/tok-1?x=1&y=2'],
    ['member', 'invite_member', 'https://agentpm.app/invite/tok-2'],
  ] as const
  for (const [variant, key, url] of cases) {
    for (const message of [undefined, 'よろしく\nお願いします <3']) {
      const suffix = message ? '_msg' : ''
      it(`${key}${suffix}`, () => {
        const out = renderInviteEmail({ variant, fields: INVITE_TEMPLATE_DEFAULTS[key], vars, inviteUrl: url, message })
        expect(out.subject).toBe(fixture(`${key}${suffix}.subject`))
        expect(out.html).toBe(fixture(`${key}${suffix}.html`))
        expect(out.text).toBe(fixture(`${key}${suffix}.txt`))
      })
    }
  }
})

describe('inviteVarsByName / INVITE_PLACEHOLDERS', () => {
  it('プログラム用の名前を日本語の差し込み語名に写す', () => {
    const byName = inviteVarsByName(vars)
    for (const p of INVITE_PLACEHOLDERS) expect(byName[p.name]).toBe(vars[p.varKey])
  })
})

describe('renderInviteEmail', () => {
  const inviteUrl = 'https://agentpm.app/invite/tok-1'

  it('差し込み値と文面内のHTMLはエスケープされる（XSS対策）', () => {
    const out = renderInviteEmail({
      variant: 'client',
      fields: { ...INVITE_TEMPLATE_DEFAULTS.invite_client, body: '<b>太字</b> {{招待者名}}' },
      vars: { ...vars, inviterName: '<script>alert(1)</script>' },
      inviteUrl,
    })
    expect(out.html).not.toContain('<script>')
    expect(out.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(out.html).toContain('&lt;b&gt;太字&lt;/b&gt;')
    expect(out.text).toContain('<script>alert(1)</script>')
  })

  it('有効期限の行はコード固定で、文面を変えても残る', () => {
    const out = renderInviteEmail({
      variant: 'member',
      fields: { ...INVITE_TEMPLATE_DEFAULTS.invite_member, body: '本文だけ' },
      vars,
      inviteUrl,
    })
    expect(out.html).toContain('<strong>2026年9月14日</strong>')
    expect(out.text).toContain('この招待リンクは 2026年9月14日 まで有効です。')
  })

  it('補足(note)が空ならボタン下の補足は出ない', () => {
    const out = renderInviteEmail({ variant: 'client', fields: { ...INVITE_TEMPLATE_DEFAULTS.invite_client, note: '' }, vars, inviteUrl })
    expect(out.html).not.toContain('リンク先でパスワードを決めるだけで参加できます')
  })
})
