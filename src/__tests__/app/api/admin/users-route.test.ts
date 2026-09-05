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

const maybeSingleMock = vi.fn()
const selectMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }))
const eqMock = vi.fn(() => ({ select: selectMock }))
const updateMock = vi.fn(() => ({ eq: eqMock }))
const fromMock = vi.fn(() => ({ update: updateMock }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: fromMock, auth: { admin: { createUser: vi.fn() } } }),
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
  maybeSingleMock.mockResolvedValue({ data: { id: TARGET_USER_ID, is_superadmin: true }, error: null })
})

describe('PATCH /api/admin/users', () => {
  it('non-superadmin は 403（更新しない）', async () => {
    verifySuperadminMock.mockResolvedValue(null)
    const res = await callPatch({ userId: TARGET_USER_ID, isSuperadmin: true })
    expect(res.status).toBe(403)
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('userId 欠落は 400', async () => {
    verifySuperadminMock.mockResolvedValue(ADMIN_USER_ID)
    const res = await callPatch({ isSuperadmin: true })
    expect(res.status).toBe(400)
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('isSuperadmin が boolean でなければ 400', async () => {
    verifySuperadminMock.mockResolvedValue(ADMIN_USER_ID)
    const res = await callPatch({ userId: TARGET_USER_ID, isSuperadmin: 'yes' })
    expect(res.status).toBe(400)
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('自分自身の旗は外せない（400・更新しない）', async () => {
    verifySuperadminMock.mockResolvedValue(ADMIN_USER_ID)
    const res = await callPatch({ userId: ADMIN_USER_ID, isSuperadmin: false })
    expect(res.status).toBe(400)
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('superadmin は他ユーザーに付与できる（service role で profiles を更新）', async () => {
    verifySuperadminMock.mockResolvedValue(ADMIN_USER_ID)
    const res = await callPatch({ userId: TARGET_USER_ID, isSuperadmin: true })
    expect(res.status).toBe(200)
    expect(fromMock).toHaveBeenCalledWith('profiles')
    expect(updateMock).toHaveBeenCalledWith({ is_superadmin: true })
    expect(eqMock).toHaveBeenCalledWith('id', TARGET_USER_ID)
    expect(await res.json()).toEqual({ userId: TARGET_USER_ID, isSuperadmin: true })
  })

  it('superadmin は他ユーザーから剥奪できる', async () => {
    verifySuperadminMock.mockResolvedValue(ADMIN_USER_ID)
    maybeSingleMock.mockResolvedValue({ data: { id: TARGET_USER_ID, is_superadmin: false }, error: null })
    const res = await callPatch({ userId: TARGET_USER_ID, isSuperadmin: false })
    expect(res.status).toBe(200)
    expect(updateMock).toHaveBeenCalledWith({ is_superadmin: false })
    expect(await res.json()).toEqual({ userId: TARGET_USER_ID, isSuperadmin: false })
  })

  it('対象ユーザーが存在しなければ 404', async () => {
    verifySuperadminMock.mockResolvedValue(ADMIN_USER_ID)
    maybeSingleMock.mockResolvedValue({ data: null, error: null })
    const res = await callPatch({ userId: TARGET_USER_ID, isSuperadmin: true })
    expect(res.status).toBe(404)
  })

  it('DB エラーは 500（内容は漏らさない）', async () => {
    verifySuperadminMock.mockResolvedValue(ADMIN_USER_ID)
    maybeSingleMock.mockResolvedValue({ data: null, error: { message: 'boom: secret detail' } })
    const res = await callPatch({ userId: TARGET_USER_ID, isSuperadmin: true })
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('secret detail')
  })
})
