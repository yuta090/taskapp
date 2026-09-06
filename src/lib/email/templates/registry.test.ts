import { describe, it, expect } from 'vitest'
import { EMAIL_TEMPLATE_DEFS, EMAIL_TEMPLATE_FAMILIES, EMAIL_TEMPLATE_KEYS, getEmailTemplateDef, isEmailTemplateKey } from './registry'
import { validateTemplateFields } from './core'

describe('email template registry', () => {
  it('全キーが DB の CHECK（^[a-z0-9_]{1,64}$）を満たし、重複しない', () => {
    for (const k of EMAIL_TEMPLATE_KEYS) expect(k).toMatch(/^[a-z0-9_]{1,64}$/)
    expect(new Set(EMAIL_TEMPLATE_KEYS).size).toBe(EMAIL_TEMPLATE_KEYS.length)
  })

  it('全テンプレの family はカテゴリ一覧に存在する', () => {
    const ids = new Set<string>(EMAIL_TEMPLATE_FAMILIES.map((f) => f.id))
    for (const d of EMAIL_TEMPLATE_DEFS) expect(ids.has(d.family)).toBe(true)
  })

  it('既定文面は自分の差し込み語だけで検証を通り、見本でプレビューできる', () => {
    for (const d of EMAIL_TEMPLATE_DEFS) {
      const r = validateTemplateFields(d.defaults, d.placeholders.map((p) => p.name))
      expect(r.ok, d.key).toBe(true)
      if (d.renderPreview) {
        const out = d.renderPreview(d.defaults, 'AgentPM')
        expect(out.html).toContain('<!DOCTYPE html>')
        expect(out.html).not.toContain('{{')
        expect(out.subject.length).toBeGreaterThan(0)
      }
    }
  })

  it('React Email 製（承認依頼・滞留リマインド）だけ renderPreview を持たず、server プレビューに回る', () => {
    const serverKeys = EMAIL_TEMPLATE_DEFS.filter((d) => !d.renderPreview).map((d) => d.key).sort()
    expect(serverKeys).toEqual(['approval_estimate', 'approval_task', 'reminder_client', 'reminder_client_overdue'])
  })

  it('isEmailTemplateKey / getEmailTemplateDef', () => {
    expect(isEmailTemplateKey('welcome')).toBe(true)
    expect(isEmailTemplateKey('nope')).toBe(false)
    expect(getEmailTemplateDef('invite_client')?.family).toBe('invite')
  })
})
