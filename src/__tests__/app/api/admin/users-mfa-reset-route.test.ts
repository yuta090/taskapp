import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/** /api/admin/users/mfa-reset — 認証アプリを失くした人の復旧（運営専用・実行者は aal2 必須・自己解除不可・監査あり） */
const verdictMock = vi.fn()
vi.mock('@/lib/admin/verify-superadmin', () => ({ verifySuperadminDetailed: verdictMock }))
const listFactorsMock = vi.fn()
const deleteFactorMock = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ auth: { admin: { mfa: { listFactors: listFactorsMock, deleteFactor: deleteFactorMock } } } }),
}))
const recordMock = vi.fn(() => Promise.resolve())
vi.mock('@/lib/auth/authEventLog', () => ({ recordAuthEvent: recordMock }))

const { POST } = await import('@/app/api/admin/users/mfa-reset/route')
const ADMIN = '99999999-9999-4999-8999-999999999999'
const USER = '11111111-1111-4111-8111-111111111111'
const call = (body: unknown) => POST(new NextRequest('http://localhost:3000/api/admin/users/mfa-reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))

beforeEach(() => {
  vi.clearAllMocks()
  verdictMock.mockResolvedValue({ ok: true, userId: ADMIN, enrolled: true })
  listFactorsMock.mockResolvedValue({ data: { factors: [{ id: 'f1' }, { id: 'f2' }] }, error: null })
  deleteFactorMock.mockResolvedValue({ error: null })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('POST /api/admin/users/mfa-reset', () => {
  it('運営以外・aal1 の運営は 403（何も消さない）。運営が aal1 なら拒否を監査に残す', async () => {
    verdictMock.mockResolvedValue({ ok: false, reason: 'mfa_required', userId: ADMIN })
    expect((await call({ userId: USER })).status).toBe(403)
    expect(deleteFactorMock).not.toHaveBeenCalled()
    expect(recordMock).toHaveBeenCalledWith(expect.objectContaining({ stage: 'mfa_reset_denied', userId: ADMIN, errorCode: 'mfa_required' }))
  })
  it('二要素認証を登録していない運営はこの操作だけはできない（403）', async () => {
    verdictMock.mockResolvedValue({ ok: true, userId: ADMIN, enrolled: false })
    expect((await call({ userId: USER })).status).toBe(403)
    expect(recordMock).toHaveBeenCalledWith(expect.objectContaining({ stage: 'mfa_reset_denied', errorCode: 'actor_not_enrolled' }))
  })
  it('自分自身は解除できない（409・監査に残す）', async () => {
    const res = await call({ userId: ADMIN })
    expect(res.status).toBe(409)
    expect(deleteFactorMock).not.toHaveBeenCalled()
    expect(recordMock).toHaveBeenCalledWith(expect.objectContaining({ stage: 'mfa_reset_denied', errorCode: 'self_reset' }))
  })
  it('userId が uuid でなければ 400', async () => {
    expect((await call({ userId: 'nope' })).status).toBe(400)
    expect((await call({})).status).toBe(400)
  })
  it('全 factor を削除して件数を返し、成功を監査に残す', async () => {
    const res = await call({ userId: USER })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ removed: 2 })
    expect(deleteFactorMock).toHaveBeenCalledWith({ id: 'f1', userId: USER })
    expect(deleteFactorMock).toHaveBeenCalledWith({ id: 'f2', userId: USER })
    expect(recordMock).toHaveBeenCalledWith(expect.objectContaining({ stage: 'mfa_reset', userId: ADMIN, metadata: { target: USER, removed: 2 } }))
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
