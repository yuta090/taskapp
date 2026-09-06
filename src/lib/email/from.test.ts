import { describe, it, expect, beforeEach, vi } from 'vitest'
import { buildFrom, sanitizeDisplayName, sanitizeReplyTo, resetFromEmailWarning } from './from'

describe('email from / reply-to', () => {
  beforeEach(() => {
    process.env.FROM_EMAIL = 'noreply@agentpm.app'
    process.env.NEXT_PUBLIC_APP_NAME = 'AgentPM'
    resetFromEmailWarning()
  })

  it('事務所名があれば「事務所名 (AgentPM)」の表示名つき、無ければ「AgentPM」', () => {
    expect(buildFrom({ orgName: '株式会社サンプル' })).toBe('"株式会社サンプル (AgentPM)" <noreply@agentpm.app>')
    expect(buildFrom()).toBe('"AgentPM" <noreply@agentpm.app>')
    expect(buildFrom({ orgName: '   ' })).toBe('"AgentPM" <noreply@agentpm.app>')
  })

  it('表示名の引用符・山かっこ・改行はヘッダを壊さないよう除去し、長すぎれば切る', () => {
    expect(sanitizeDisplayName('A"B<C>D\r\nE')).toBe('ABCDE')
    expect(buildFrom({ orgName: 'x'.repeat(200) })).toContain(`"${'x'.repeat(60)}`)
    expect(buildFrom({ orgName: 'x'.repeat(200) })).not.toContain('x'.repeat(61))
  })

  it('FROM_EMAIL 未設定なら既定アドレスで、警告は1回だけ', () => {
    delete process.env.FROM_EMAIL
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(buildFrom()).toBe('"AgentPM" <noreply@taskapp.example.com>')
    buildFrom({ orgName: 'X' })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('FROM_EMAIL が未設定です'))
  })

  it('返信先はメールアドレスの形のときだけ使う（改行・空・不正は undefined）', () => {
    expect(sanitizeReplyTo('tanaka@example.com')).toBe('tanaka@example.com')
    expect(sanitizeReplyTo(' Tanaka@Example.com ')).toBe('Tanaka@Example.com')
    expect(sanitizeReplyTo('bad\r\nBcc: x@y')).toBeUndefined()
    expect(sanitizeReplyTo('')).toBeUndefined()
    expect(sanitizeReplyTo(null)).toBeUndefined()
    expect(sanitizeReplyTo('not-an-email')).toBeUndefined()
  })
})
