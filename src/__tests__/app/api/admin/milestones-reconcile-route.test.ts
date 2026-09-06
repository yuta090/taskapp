import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * /api/admin/milestones/reconcile — 節目の再集計（運営専用）。
 * 門番は verifySuperadmin。DB の reconcile_org_milestones() を service role で呼ぶだけ。
 */
const verifySuperadminMock = vi.fn()
vi.mock('@/lib/admin/verify-superadmin', () => ({
  verifySuperadmin: verifySuperadminMock,
}))

const rpcMock = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ rpc: rpcMock }),
}))

const { POST } = await import('@/app/api/admin/milestones/reconcile/route')

const ADMIN_USER_ID = '99999999-9999-4999-8999-999999999999'
const ORG_ID = 'aaaaaaaa-0000-4000-8000-000000000001'

function callPost(body?: unknown) {
  return POST(
    new NextRequest('http://localhost:3000/api/admin/milestones/reconcile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  verifySuperadminMock.mockResolvedValue(ADMIN_USER_ID)
  rpcMock.mockResolvedValue({ data: 3, error: null })
})

describe('POST /api/admin/milestones/reconcile', () => {
  it('non-superadmin は 403（RPC を呼ばない）', async () => {
    verifySuperadminMock.mockResolvedValue(null)
    const res = await callPost()
    expect(res.status).toBe(403)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('body 無しなら全組織を再集計し、追加件数を返す', async () => {
    const res = await callPost()
    expect(res.status).toBe(200)
    expect(rpcMock).toHaveBeenCalledWith('reconcile_org_milestones', { p_org_id: null })
    expect(await res.json()).toEqual({ added: 3, orgId: null })
  })

  it('orgId を渡せばその組織だけ', async () => {
    await callPost({ orgId: ORG_ID })
    expect(rpcMock).toHaveBeenCalledWith('reconcile_org_milestones', { p_org_id: ORG_ID })
  })

  it('orgId が UUID でなければ 400', async () => {
    const res = await callPost({ orgId: 'nope' })
    expect(res.status).toBe(400)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('RPC エラーは 500', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'boom' } })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await callPost()
    expect(res.status).toBe(500)
    spy.mockRestore()
  })
})
