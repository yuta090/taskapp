import { describe, it, expect, vi, beforeEach } from 'vitest'

let user: { id: string } | null = { id: 'admin-1' }
let isSuperadmin = true
let aalCheck: { ok: boolean; reason?: string; enrolled?: boolean } = { ok: true, enrolled: true }
vi.mock('@/lib/supabase/server', () => ({
  createClient: () =>
    Promise.resolve({
      auth: { getUser: () => Promise.resolve({ data: { user } }) },
      from: () => ({ select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { is_superadmin: isSuperadmin } }) }) }) }),
    }),
}))
const checkAal2Mock = vi.fn()
vi.mock('@/lib/auth/requireAal2', () => ({ checkAal2: checkAal2Mock }))

const { verifySuperadmin, verifySuperadminDetailed } = await import('@/lib/admin/verify-superadmin')

beforeEach(() => {
  vi.clearAllMocks()
  user = { id: 'admin-1' }
  isSuperadmin = true
  aalCheck = { ok: true, enrolled: true }
  checkAal2Mock.mockImplementation(() => Promise.resolve({ ...aalCheck, userId: 'admin-1' }))
  delete process.env.ADMIN_MFA_REQUIRED
})

describe('verifySuperadmin（運営 API の門番）', () => {
  it('superadmin かつ aal2 条件を満たせば userId', async () => {
    expect(await verifySuperadmin()).toBe('admin-1')
  })
  it('未ログイン・非 superadmin は null（理由つき）', async () => {
    user = null
    expect(await verifySuperadminDetailed()).toEqual({ ok: false, reason: 'unauthenticated' })
    user = { id: 'u' }
    isSuperadmin = false
    expect(await verifySuperadminDetailed()).toMatchObject({ ok: false, reason: 'not_superadmin' })
    expect(checkAal2Mock).not.toHaveBeenCalled()
  })
  it('登録済み × aal1 は mfa_required で null（API 側で本当に強制）', async () => {
    aalCheck = { ok: false, reason: 'mfa_required' }
    expect(await verifySuperadmin()).toBeNull()
    expect(await verifySuperadminDetailed()).toMatchObject({ ok: false, reason: 'mfa_required' })
  })
  it('ADMIN_MFA_REQUIRED=true のときだけ strict で判定する', async () => {
    await verifySuperadmin()
    expect(checkAal2Mock).toHaveBeenLastCalledWith(expect.anything(), { strict: false })
    process.env.ADMIN_MFA_REQUIRED = 'true'
    await verifySuperadmin()
    expect(checkAal2Mock).toHaveBeenLastCalledWith(expect.anything(), { strict: true })
  })
})
