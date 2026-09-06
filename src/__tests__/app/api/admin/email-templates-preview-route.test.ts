import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/** /api/admin/email-templates/preview — 編集中の文面を見本で描く（運営専用・保存しない） */
const verifySuperadminMock = vi.fn()
vi.mock('@/lib/admin/verify-superadmin', () => ({ verifySuperadmin: verifySuperadminMock }))

const renderMock = vi.fn()
vi.mock('@/lib/email/templates/serverPreview', () => ({ renderEmailPreview: renderMock }))

const { POST } = await import('@/app/api/admin/email-templates/preview/route')

function call(body: unknown) {
  return POST(new NextRequest('http://localhost:3000/api/admin/email-templates/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
}

beforeEach(() => {
  vi.clearAllMocks()
  verifySuperadminMock.mockResolvedValue('admin-1')
  renderMock.mockResolvedValue({ subject: 'S', html: '<!DOCTYPE html>', text: 'T' })
})

describe('POST /api/admin/email-templates/preview', () => {
  it('non-superadmin は 403', async () => {
    verifySuperadminMock.mockResolvedValue(null)
    expect((await call({ key: 'approval_task', fields: {} })).status).toBe(403)
    expect(renderMock).not.toHaveBeenCalled()
  })

  it('台帳外キーは 400', async () => {
    expect((await call({ key: 'nope', fields: {} })).status).toBe(400)
  })

  it('入力途中でも描く: 文字列以外は空・上限超えは切る・ボタン空は1文字にする', async () => {
    const res = await call({ key: 'approval_task', fields: { subject: 'あ'.repeat(300), heading: 5, body: '本文' } })
    expect(res.status).toBe(200)
    const fields = renderMock.mock.calls[0][1] as Record<string, string>
    expect(fields.subject.length).toBe(200)
    expect(fields.heading).toBe('')
    expect(fields.body).toBe('本文')
    expect(fields.cta_label).toBe(' ')
    expect(await res.json()).toEqual({ subject: 'S', html: '<!DOCTYPE html>', text: 'T' })
  })

  it('描画に失敗したら 500（内容は漏らさない）', async () => {
    renderMock.mockRejectedValue(new Error('secret stack'))
    const res = await call({ key: 'approval_task', fields: {} })
    expect(res.status).toBe(500)
    expect((await res.json()).error).not.toContain('secret')
  })
})
