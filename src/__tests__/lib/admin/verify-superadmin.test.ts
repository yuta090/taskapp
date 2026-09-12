import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * verifySuperadminDetailed / verifySuperadmin は React の cache() で包み、1リクエストに
 * つき1回だけ実行する（(panel) layout と各ページの両方が呼んでいたのを1回にまとめる）。
 * cache() の重複排除そのものは、実際のリクエスト（Next.js の RSC レンダー）単位の
 * キャッシュ範囲に依存するため、この Vitest（Node）環境では検証できない
 * （このファイルの各テストは cache() を経由しても判定結果自体が変わらないことを確かめる）。
 */

let user: { id: string } | null = { id: 'admin-1' }
let rpcResponse: { data: boolean | null; error: { code: string; message: string } | null } = {
  data: true,
  error: null,
}
let aalCheck: { ok: boolean; reason?: string; enrolled?: boolean } = { ok: true, enrolled: true }
const rpcMock = vi.fn((..._args: unknown[]) => Promise.resolve(rpcResponse))
vi.mock('@/lib/supabase/server', () => ({
  createClient: () =>
    Promise.resolve({
      auth: { getUser: () => Promise.resolve({ data: { user } }) },
      rpc: (...args: unknown[]) => rpcMock(...args),
    }),
}))
const checkAal2Mock = vi.fn()
vi.mock('@/lib/auth/requireAal2', () => ({ checkAal2: checkAal2Mock }))

const { verifySuperadmin, verifySuperadminDetailed } = await import('@/lib/admin/verify-superadmin')

beforeEach(() => {
  vi.clearAllMocks()
  user = { id: 'admin-1' }
  rpcResponse = { data: true, error: null }
  aalCheck = { ok: true, enrolled: true }
  checkAal2Mock.mockImplementation(() => Promise.resolve({ ...aalCheck, userId: 'admin-1' }))
  delete process.env.ADMIN_MFA_REQUIRED
})

describe('verifySuperadmin（運営 API の門番）', () => {
  it('superadmin かつ aal2 条件を満たせば userId', async () => {
    expect(await verifySuperadmin()).toBe('admin-1')
    expect(rpcMock).toHaveBeenCalledWith('rpc_is_superadmin')
  })
  it('未ログイン・非 superadmin は null（理由つき）', async () => {
    user = null
    expect(await verifySuperadminDetailed()).toEqual({ ok: false, reason: 'unauthenticated' })
    user = { id: 'u' }
    rpcResponse = { data: false, error: null }
    expect(await verifySuperadminDetailed()).toMatchObject({ ok: false, reason: 'not_superadmin' })
    expect(checkAal2Mock).not.toHaveBeenCalled()
  })
  it('登録済み × aal1 は mfa_required で null（API 側で本当に強制）', async () => {
    aalCheck = { ok: false, reason: 'mfa_required' }
    expect(await verifySuperadmin()).toBeNull()
    expect(await verifySuperadminDetailed()).toMatchObject({ ok: false, reason: 'mfa_required' })
  })
  // rpc_is_superadmin() は SECURITY DEFINER で profiles の RLS を経由しないが、
  // db_pre_request（20260907144900_mfa_pre_request.sql）は role/セッション単位の
  // 見張りなので、RPC 呼び出しでも同じ理由(42501)で拒否される
  it('rpc_is_superadmin が db_pre_request の42501を返しても、mfa_requiredとして扱う（「運営でない」に化けさせない）', async () => {
    rpcResponse = { data: null, error: { code: '42501', message: 'mfa_required' } }
    expect(await verifySuperadmin()).toBeNull()
    expect(await verifySuperadminDetailed()).toMatchObject({ ok: false, reason: 'mfa_required', userId: 'admin-1' })
    expect(checkAal2Mock).not.toHaveBeenCalled()
  })
  // 42501 は「関数の実行権が無い」等、二要素の途中とは別の理由でも返る符号。
  // message まで mfa_required と一致しない場合は「運営でない」にも化けさせず、
  // 判定できない扱い(check_failed)にして締め出す（fail-closed）
  it('42501でもmessageがmfa_requiredでなければcheck_failedにする（「運営でない」に化けさせない）', async () => {
    rpcResponse = { data: null, error: { code: '42501', message: 'permission denied for function rpc_is_superadmin' } }
    expect(await verifySuperadmin()).toBeNull()
    expect(await verifySuperadminDetailed()).toMatchObject({ ok: false, reason: 'check_failed', userId: 'admin-1' })
    expect(checkAal2Mock).not.toHaveBeenCalled()
  })
  it('ADMIN_MFA_REQUIRED=true のときだけ strict で判定する', async () => {
    await verifySuperadmin()
    expect(checkAal2Mock).toHaveBeenLastCalledWith(expect.anything(), { strict: false })
    process.env.ADMIN_MFA_REQUIRED = 'true'
    await verifySuperadmin()
    expect(checkAal2Mock).toHaveBeenLastCalledWith(expect.anything(), { strict: true })
  })
})
