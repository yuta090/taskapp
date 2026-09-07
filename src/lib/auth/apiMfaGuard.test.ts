import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const checkAal2Mock = vi.fn()
vi.mock('./requireAal2', () => ({ checkAal2: checkAal2Mock }))
const { mfaGuardResponse, mfaRedirectResponse } = await import('./apiMfaGuard')
const client = {} as SupabaseClient

describe('mfaGuardResponse', () => {
  it('通してよい（ok / 未ログイン）ときは null', async () => {
    checkAal2Mock.mockResolvedValueOnce({ ok: true, userId: 'u', enrolled: true })
    expect(await mfaGuardResponse(client)).toBeNull()
    checkAal2Mock.mockResolvedValueOnce({ ok: false, reason: 'unauthenticated' })
    expect(await mfaGuardResponse(client)).toBeNull()
  })
  it('登録済み × コード未入力、判定不能は 403', async () => {
    for (const reason of ['mfa_required', 'check_failed']) {
      checkAal2Mock.mockResolvedValueOnce({ ok: false, reason, userId: 'u' })
      const res = await mfaGuardResponse(client)
      expect(res?.status, reason).toBe(403)
      expect((await res!.json()).error).toBe('mfa_required')
    }
  })
  it('mfaRedirectResponse は弾くときコード入力画面へリダイレクト', async () => {
    checkAal2Mock.mockResolvedValueOnce({ ok: false, reason: 'mfa_required', userId: 'u' })
    const res = await mfaRedirectResponse(client, null, 'https://agentpm.app', '/settings/integrations')
    expect(res?.status).toBe(307)
    expect(res?.headers.get('location')).toBe('https://agentpm.app/login/mfa?redirect=%2Fsettings%2Fintegrations')
    checkAal2Mock.mockResolvedValueOnce({ ok: true, userId: 'u', enrolled: false })
    expect(await mfaRedirectResponse(client, null, 'https://agentpm.app', '/x')).toBeNull()
  })
})
