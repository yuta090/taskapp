import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * /api/admin/users — 運営（superadmin）の付与・剥奪（PATCH）。
 *
 * 背景: profiles.is_superadmin はトリガーで「service role だけが変更できる」に固定した
 * （20260906082330_profiles_superadmin_guard.sql）。運営を後から増やす正規の経路はこの API のみ。
 * 門番は verifySuperadmin。自分自身の旗は外せない（運営が 0 人になり誰も入れなくなる事故を防ぐ）。
 */

const verifySuperadminMock = vi.fn()
vi.mock('@/lib/admin/verify-superadmin', () => ({
  verifySuperadmin: verifySuperadminMock,
}))

const rpcMock = vi.fn()
const fromMock = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ rpc: rpcMock, from: fromMock, auth: { admin: { createUser: vi.fn() } } }),
}))

const { PATCH } = await import('@/app/api/admin/users/route')

const ADMIN_USER_ID = '99999999-9999-4999-8999-999999999999'
const TARGET_USER_ID = '11111111-1111-4111-8111-111111111111'

function callPatch(body: unknown) {
  return PATCH(
    new NextRequest('http://localhost:3000/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  rpcMock.mockResolvedValue({ data: [{ id: TARGET_USER_ID, is_superadmin: true }], error: null })
})

describe('PATCH /api/admin/users', () => {
  it('non-superadmin は 403（更新しない）', async () => {
    verifySuperadminMock.mockResolvedValue(null)
    const res = await callPatch({ userId: TARGET_USER_ID, isSuperadmin: true })
    expect(res.status).toBe(403)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('userId 欠落は 400', async () => {
    verifySuperadminMock.mockResolvedValue(ADMIN_USER_ID)
    const res = await callPatch({ isSuperadmin: true })
    expect(res.status).toBe(400)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('本文が null / userId が UUID でない場合も 400（500 にしない）', async () => {
    verifySuperadminMock.mockResolvedValue(ADMIN_USER_ID)
    expect((await callPatch(null)).status).toBe(400)
    expect((await callPatch({ userId: 'not-a-uuid', isSuperadmin: true })).status).toBe(400)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('isSuperadmin が boolean でなければ 400', async () => {
    verifySuperadminMock.mockResolvedValue(ADMIN_USER_ID)
    const res = await callPatch({ userId: TARGET_USER_ID, isSuperadmin: 'yes' })
    expect(res.status).toBe(400)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('自分自身の旗は外せない（400・更新しない）', async () => {
    verifySuperadminMock.mockResolvedValue(ADMIN_USER_ID)
    const res = await callPatch({ userId: ADMIN_USER_ID, isSuperadmin: false })
    expect(res.status).toBe(400)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('superadmin は他ユーザーに付与できる（鍵付き RPC に actor/target/flag を渡す）', async () => {
    verifySuperadminMock.mockResolvedValue(ADMIN_USER_ID)
    const res = await callPatch({ userId: TARGET_USER_ID, isSuperadmin: true })
    expect(res.status).toBe(200)
    expect(rpcMock).toHaveBeenCalledWith('rpc_admin_set_superadmin', {
      p_actor: ADMIN_USER_ID,
      p_target: TARGET_USER_ID,
      p_flag: true,
    })
    expect(await res.json()).toEqual({ userId: TARGET_USER_ID, isSuperadmin: true })
  })

  it('superadmin は他ユーザーから剥奪できる（結果は RPC の返り値を正とする）', async () => {
    verifySuperadminMock.mockResolvedValue(ADMIN_USER_ID)
    rpcMock.mockResolvedValue({ data: [{ id: TARGET_USER_ID, is_superadmin: false }], error: null })
    const res = await callPatch({ userId: TARGET_USER_ID, isSuperadmin: false })
    expect(res.status).toBe(200)
    expect(rpcMock).toHaveBeenCalledWith('rpc_admin_set_superadmin', {
      p_actor: ADMIN_USER_ID,
      p_target: TARGET_USER_ID,
      p_flag: false,
    })
    expect(await res.json()).toEqual({ userId: TARGET_USER_ID, isSuperadmin: false })
  })

  it('対象ユーザーが存在しなければ 404（RPC の no_data_found）', async () => {
    verifySuperadminMock.mockResolvedValue(ADMIN_USER_ID)
    rpcMock.mockResolvedValue({ data: null, error: { code: 'P0002', message: 'user not found' } })
    const res = await callPatch({ userId: TARGET_USER_ID, isSuperadmin: true })
    expect(res.status).toBe(404)
  })

  it('RPC 内で actor が運営でなくなっていれば 403（剥奪済みの遅延リクエスト）', async () => {
    verifySuperadminMock.mockResolvedValue(ADMIN_USER_ID)
    rpcMock.mockResolvedValue({ data: null, error: { code: '42501', message: 'actor is not superadmin' } })
    const res = await callPatch({ userId: TARGET_USER_ID, isSuperadmin: false })
    expect(res.status).toBe(403)
  })

  it('RPC 側で自己剥奪(AD001)を拒否したら 409', async () => {
    verifySuperadminMock.mockResolvedValue(ADMIN_USER_ID)
    rpcMock.mockResolvedValue({ data: null, error: { code: 'AD001', message: 'cannot revoke own superadmin' } })
    const res = await callPatch({ userId: TARGET_USER_ID, isSuperadmin: false })
    expect(res.status).toBe(409)
  })

  it('DB エラーは 500（内容は漏らさない）', async () => {
    verifySuperadminMock.mockResolvedValue(ADMIN_USER_ID)
    rpcMock.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'boom: secret detail' } })
    const res = await callPatch({ userId: TARGET_USER_ID, isSuperadmin: true })
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('secret detail')
  })
})
