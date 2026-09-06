import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * /api/admin/email-templates — 招待メール文面の保存（運営専用）。
 * 門番は verifySuperadmin。保存は service role で email_templates に upsert、
 * 「既定に戻す」は行削除（コード既定が自動的に効く）。
 */
const verifySuperadminMock = vi.fn()
vi.mock('@/lib/admin/verify-superadmin', () => ({
  verifySuperadmin: verifySuperadminMock,
}))

const upsertMock = vi.fn()
const deleteEqMock = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      upsert: upsertMock,
      delete: () => ({ eq: deleteEqMock }),
    }),
  }),
}))

const { PUT } = await import('@/app/api/admin/email-templates/route')

const ADMIN_USER_ID = '99999999-9999-4999-8999-999999999999'

function callPut(body: unknown) {
  return PUT(
    new NextRequest('http://localhost:3000/api/admin/email-templates', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  )
}

const goodFields = { subject: '件名', heading: '見出し', body: '本文 {{組織名}}', cta_label: '開く', note: '' }

beforeEach(() => {
  vi.clearAllMocks()
  verifySuperadminMock.mockResolvedValue(ADMIN_USER_ID)
  upsertMock.mockResolvedValue({ error: null })
  deleteEqMock.mockResolvedValue({ error: null })
})

describe('PUT /api/admin/email-templates', () => {
  it('non-superadmin は 403（保存しない）', async () => {
    verifySuperadminMock.mockResolvedValue(null)
    const res = await callPut({ key: 'invite_client', fields: goodFields })
    expect(res.status).toBe(403)
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('壊れたJSON・知らないキーは 400', async () => {
    expect((await callPut('{not json')).status).toBe(400)
    expect((await callPut({ key: 'welcome', fields: goodFields })).status).toBe(400)
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('文面が不正なら 400 で理由を返す', async () => {
    const res = await callPut({ key: 'invite_client', fields: { ...goodFields, subject: '' } })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(typeof json.error).toBe('string')
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('正常なら upsert して保存後の文面を返す', async () => {
    const res = await callPut({ key: 'invite_member', fields: { ...goodFields, subject: '  件名  ' } })
    expect(res.status).toBe(200)
    expect(upsertMock).toHaveBeenCalledTimes(1)
    const row = upsertMock.mock.calls[0][0] as Record<string, unknown>
    expect(row.key).toBe('invite_member')
    expect(row.subject).toBe('件名')
    expect(row.updated_by).toBe(ADMIN_USER_ID)
    const json = await res.json()
    expect(json.fields.subject).toBe('件名')
    expect(json.isCustom).toBe(true)
  })

  it('reset:true なら行を消して既定文面を返す', async () => {
    const res = await callPut({ key: 'invite_client', reset: true })
    expect(res.status).toBe(200)
    expect(deleteEqMock).toHaveBeenCalledWith('key', 'invite_client')
    expect(upsertMock).not.toHaveBeenCalled()
    const json = await res.json()
    expect(json.isCustom).toBe(false)
    expect(json.fields.heading).toBe('プロジェクトへの招待')
  })

  it('DBエラーは 500（内容は漏らさない）', async () => {
    upsertMock.mockResolvedValue({ error: { message: 'relation missing secret' } })
    const res = await callPut({ key: 'invite_client', fields: goodFields })
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).not.toContain('secret')
  })
})
