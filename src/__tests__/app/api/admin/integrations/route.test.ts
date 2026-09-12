import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 運営の判定は共通の verifySuperadmin()（src/lib/admin/verify-superadmin.ts）で行う。
 * 二要素のコード入力(aal2)・ADMIN_MFA_REQUIRED まで確かめるのはその共通関数の責務で、
 * ここでは共通関数を実物のまま使い、この route がその結果（userIdかnull）を
 * 正しく403に反映することを確かめる。
 */

let user: { id: string } | null = { id: 'user-1' }
let rpcResponse: { data: boolean | null; error: { code: string } | null } = { data: true, error: null }
const rpcMock = vi.fn((..._args: unknown[]) => Promise.resolve(rpcResponse))

vi.mock('@/lib/supabase/server', () => ({
  createClient: () =>
    Promise.resolve({
      auth: { getUser: () => Promise.resolve({ data: { user } }) },
      rpc: (...args: unknown[]) => rpcMock(...args),
    }),
}))

let aalCheck: { ok: boolean; reason?: string; enrolled?: boolean } = { ok: true, enrolled: true }
const checkAal2Mock = vi.fn((..._args: unknown[]) => Promise.resolve(aalCheck))
vi.mock('@/lib/auth/requireAal2', () => ({ checkAal2: (...args: unknown[]) => checkAal2Mock(...args) }))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        order: () => Promise.resolve({ data: [], error: null }),
      }),
    }),
  }),
}))

vi.mock('@/lib/integrations/system-config', () => ({
  invalidateCache: vi.fn(),
}))

const { GET } = await import('@/app/api/admin/integrations/route')

beforeEach(() => {
  vi.clearAllMocks()
  user = { id: 'user-1' }
  rpcResponse = { data: true, error: null }
  aalCheck = { ok: true, enrolled: true }
  delete process.env.ADMIN_MFA_REQUIRED
})

describe('GET /api/admin/integrations — 運営の判定は共通のverifySuperadmin()に一本化する', () => {
  it('運営かつ二要素の条件を満たせば403にしない（先へ進む）', async () => {
    const response = await GET()
    expect(response.status).not.toBe(403)
    expect(rpcMock).toHaveBeenCalledWith('rpc_is_superadmin')
  })

  it('運営でなければ403', async () => {
    rpcResponse = { data: false, error: null }
    const response = await GET()
    expect(response.status).toBe(403)
  })

  it('未ログインなら403', async () => {
    user = null
    const response = await GET()
    expect(response.status).toBe(403)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  // 運営の判定は共通の verifySuperadmin() が二要素の状態も確かめる。
  // 運営でも、二要素のコード入力前(aal1)なら403にする
  it('運営でも、二要素のコード入力前(aal1)なら403にする', async () => {
    aalCheck = { ok: false, reason: 'mfa_required' }
    const response = await GET()
    expect(response.status).toBe(403)
  })
})
