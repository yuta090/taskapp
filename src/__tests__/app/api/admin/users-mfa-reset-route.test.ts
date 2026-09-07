import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/** /api/admin/users/mfa-reset — 認証アプリを失くした人の復旧（運営専用） */
const verifySuperadminMock = vi.fn()
vi.mock('@/lib/admin/verify-superadmin', () => ({ verifySuperadmin: verifySuperadminMock }))
const listFactorsMock = vi.fn()
const deleteFactorMock = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ auth: { admin: { mfa: { listFactors: listFactorsMock, deleteFactor: deleteFactorMock } } } }),
}))
const { POST } = await import('@/app/api/admin/users/mfa-reset/route')
const USER = '11111111-1111-4111-8111-111111111111'
const call = (body: unknown) => POST(new NextRequest('http://localhost:3000/api/admin/users/mfa-reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))

beforeEach(() => {
  vi.clearAllMocks()
  verifySuperadminMock.mockResolvedValue('admin-1')
  listFactorsMock.mockResolvedValue({ data: { factors: [{ id: 'f1' }, { id: 'f2' }] }, error: null })
  deleteFactorMock.mockResolvedValue({ error: null })
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('POST /api/admin/users/mfa-reset', () => {
  it('運営以外は 403（何も消さない）', async () => {
    verifySuperadminMock.mockResolvedValue(null)
    expect((await call({ userId: USER })).status).toBe(403)
    expect(deleteFactorMock).not.toHaveBeenCalled()
  })
  it('userId が uuid でなければ 400', async () => {
    expect((await call({ userId: 'nope' })).status).toBe(400)
    expect((await call({})).status).toBe(400)
  })
  it('全 factor を削除して件数を返す', async () => {
    const res = await call({ userId: USER })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ removed: 2 })
    expect(deleteFactorMock).toHaveBeenCalledWith({ id: 'f1', userId: USER })
    expect(deleteFactorMock).toHaveBeenCalledWith({ id: 'f2', userId: USER })
  })
  it('登録が無ければ removed:0', async () => {
    listFactorsMock.mockResolvedValue({ data: { factors: [] }, error: null })
    expect(await (await call({ userId: USER })).json()).toEqual({ removed: 0 })
  })
  it('削除に失敗したら 500（内容は漏らさない）', async () => {
    deleteFactorMock.mockResolvedValueOnce({ error: { message: 'secret detail' } })
    const res = await call({ userId: USER })
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('secret detail')
  })
})
