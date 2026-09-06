import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * /api/admin/organizations/[id]/acquisition — 流入経路の手動登録（運営専用）。
 * 門番は verifySuperadmin。保存は service role で org_acquisition に upsert（channel_source='manual'）。
 */
const verifySuperadminMock = vi.fn()
vi.mock('@/lib/admin/verify-superadmin', () => ({
  verifySuperadmin: verifySuperadminMock,
}))

const upsertMock = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({ upsert: upsertMock }),
  }),
}))

const { PATCH } = await import('@/app/api/admin/organizations/[id]/acquisition/route')

const ADMIN_USER_ID = '99999999-9999-4999-8999-999999999999'
const ORG_ID = 'aaaaaaaa-0000-4000-8000-000000000001'

function callPatch(body: unknown, id: string = ORG_ID) {
  return PATCH(
    new NextRequest(`http://localhost:3000/api/admin/organizations/${id}/acquisition`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  verifySuperadminMock.mockResolvedValue(ADMIN_USER_ID)
  upsertMock.mockResolvedValue({ error: null })
})

describe('PATCH /api/admin/organizations/[id]/acquisition', () => {
  it('non-superadmin は 403（保存しない）', async () => {
    verifySuperadminMock.mockResolvedValue(null)
    const res = await callPatch({ channel: 'sales' })
    expect(res.status).toBe(403)
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('組織IDが UUID でなければ 400', async () => {
    const res = await callPatch({ channel: 'sales' }, 'not-a-uuid')
    expect(res.status).toBe(400)
  })

  it('未知のチャネル・unknown は 400', async () => {
    expect((await callPatch({ channel: 'magic' })).status).toBe(400)
    expect((await callPatch({ channel: 'unknown' })).status).toBe(400)
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('メモが長すぎれば 400', async () => {
    const res = await callPatch({ channel: 'sales', note: 'x'.repeat(501) })
    expect(res.status).toBe(400)
  })

  it('手動登録として保存し、日本語ラベル付きで返す', async () => {
    const res = await callPatch({ channel: 'sales', note: '  展示会で名刺交換  ' })
    expect(res.status).toBe(200)
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: ORG_ID,
        channel: 'sales',
        channel_source: 'manual',
        note: '展示会で名刺交換',
        updated_by: ADMIN_USER_ID,
      }),
      { onConflict: 'org_id' },
    )
    const json = await res.json()
    expect(json.channelLabel).toBe('営業・直接の紹介')
    expect(json.channelSource).toBe('manual')
  })

  it('メモ空は null で保存', async () => {
    await callPatch({ channel: 'event' })
    expect(upsertMock.mock.calls[0][0].note).toBeNull()
  })

  it('DB エラーは 500', async () => {
    upsertMock.mockResolvedValue({ error: { message: 'boom' } })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await callPatch({ channel: 'sales' })
    expect(res.status).toBe(500)
    spy.mockRestore()
  })
})
