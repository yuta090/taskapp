import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { checkAal2, readAalClaim } from './requireAal2'

function jwt(payload: Record<string, unknown>) {
  const b64 = (s: string) => Buffer.from(s).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `${b64('{"alg":"HS256"}')}.${b64(JSON.stringify(payload))}.sig`
}
function client(opts: { user?: { id: string } | null; aal?: 'aal1' | 'aal2'; factors?: Array<{ status: string }>; listError?: boolean }) {
  return {
    auth: {
      getUser: () => Promise.resolve({ data: { user: opts.user === undefined ? { id: 'u1' } : opts.user } }),
      getSession: () => Promise.resolve({ data: { session: { access_token: jwt({ aal: opts.aal ?? 'aal1' }) } } }),
      mfa: {
        listFactors: () =>
          Promise.resolve(opts.listError ? { data: null, error: { message: 'down' } } : { data: { all: opts.factors ?? [] }, error: null }),
      },
    },
  } as unknown as SupabaseClient
}

describe('readAalClaim', () => {
  it('署名済みトークンの aal を読む（壊れていれば null）', () => {
    expect(readAalClaim(jwt({ aal: 'aal2' }))).toBe('aal2')
    expect(readAalClaim(jwt({ aal: 'aal1' }))).toBe('aal1')
    expect(readAalClaim('garbage')).toBeNull()
    expect(readAalClaim(null)).toBeNull()
  })
})

describe('checkAal2', () => {
  it('未ログインは unauthenticated', async () => {
    expect(await checkAal2(client({ user: null }))).toEqual({ ok: false, reason: 'unauthenticated' })
  })
  it('未登録は通す（strict でなければ）', async () => {
    expect(await checkAal2(client({}))).toEqual({ ok: true, userId: 'u1', enrolled: false })
  })
  it('登録済み × aal1 は mfa_required、aal2 なら通す', async () => {
    expect(await checkAal2(client({ factors: [{ status: 'verified' }], aal: 'aal1' }))).toMatchObject({ ok: false, reason: 'mfa_required' })
    expect(await checkAal2(client({ factors: [{ status: 'verified' }], aal: 'aal2' }))).toEqual({ ok: true, userId: 'u1', enrolled: true })
  })
  it('未確認 factor だけなら未登録扱い', async () => {
    expect(await checkAal2(client({ factors: [{ status: 'unverified' }] }))).toMatchObject({ ok: true, enrolled: false })
  })
  it('strict: 未登録は mfa_not_enrolled', async () => {
    expect(await checkAal2(client({}), { strict: true })).toMatchObject({ ok: false, reason: 'mfa_not_enrolled' })
  })
  it('factor 一覧が取れなければ check_failed（fail-closed）', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await checkAal2(client({ listError: true }))).toMatchObject({ ok: false, reason: 'check_failed' })
  })
  it('例外（auth が無い等）も check_failed で締め出す', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await checkAal2({ auth: undefined } as unknown as SupabaseClient)).toMatchObject({ ok: false, reason: 'check_failed' })
  })
})
