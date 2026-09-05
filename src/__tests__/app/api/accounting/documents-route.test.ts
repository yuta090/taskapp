import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * 発行経路の回帰テスト。守りたいのは「二重発行しない」ことに尽きる。
 * とくに二度押しの2回目が **外部APIを叩く前に** 止まることを固定する
 * （止まらないと同じ請求書が2通、取引先に届く）。
 */

const SPACE = '11111111-1111-4111-8111-111111111111'
const TASK_A = '22222222-2222-4222-8222-222222222222'
const TASK_B = '33333333-3333-4333-8333-333333333333'
const ORG = '44444444-4444-4444-8444-444444444444'

let authUser: { id: string } | null
let membershipRole: string | null
let partnerLink: { external_partner_id: string } | null
let taskRows: Array<{ id: string; title: string }>
let pricingRows: Array<{ task_id: string; sell_total: number | null }>
let insertResult: { data: { id: string } | null; error: { code?: string } | null }
let existingDocument: Record<string, unknown> | null

const createDocument = vi.fn()

/** 全メソッドが自分を返し、終端で result を解決する簡易チェーン。 */
function chain(result: unknown) {
  const obj: Record<string, unknown> = {}
  for (const m of ['select', 'insert', 'update', 'delete', 'upsert', 'eq', 'in', 'order', 'limit']) {
    obj[m] = vi.fn(() => obj)
  }
  obj.single = vi.fn(() => Promise.resolve(result))
  obj.maybeSingle = vi.fn(() => Promise.resolve(result))
  obj.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return obj
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: vi.fn(() => Promise.resolve({ data: { user: authUser } })) },
      from: vi.fn((table: string) => {
        if (table === 'space_memberships') {
          return chain({ data: membershipRole ? { role: membershipRole } : null, error: null })
        }
        return chain({ data: [], error: null })
      }),
    }),
  ),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'spaces') return chain({ data: { id: SPACE, name: 'テスト案件', org_id: ORG }, error: null })
      if (table === 'accounting_partner_links') return chain({ data: partnerLink, error: null })
      if (table === 'tasks') return chain({ data: taskRows, error: null })
      if (table === 'task_pricing') return chain({ data: pricingRows, error: null })
      if (table === 'billing_document_tasks') return chain({ data: null, error: null })
      if (table === 'billing_documents') {
        const node: Record<string, unknown> = {}
        node.insert = vi.fn(() => chain(insertResult))
        node.select = vi.fn(() => chain({ data: existingDocument, error: null }))
        node.update = vi.fn(() => chain({ data: { id: 'doc-1', status: 'issued' }, error: null }))
        node.delete = vi.fn(() => chain({ data: null, error: null }))
        return node
      }
      return chain({ data: null, error: null })
    }),
  })),
}))

vi.mock('@/lib/accounting/connection', () => ({
  resolveAccountingConnection: vi.fn(() =>
    Promise.resolve({
      status: 'ok',
      connectionId: 'conn-1',
      adapter: { createDocument },
      ctx: { credentials: { token: 't' } },
    }),
  ),
  connectionErrorResponse: (status: string) => ({ error: status, httpStatus: 409 }),
}))

const { POST } = await import('@/app/api/accounting/documents/route')

function req(body: unknown): NextRequest {
  return new NextRequest(new URL('/api/accounting/documents', 'http://localhost:3000'), {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

const VALID_BODY = {
  spaceId: SPACE,
  provider: 'freee',
  docType: 'invoice',
  taskIds: [TASK_A, TASK_B],
  issueDate: '2026-07-31',
}

describe('POST /api/accounting/documents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authUser = { id: 'user-1' }
    membershipRole = 'admin'
    partnerLink = { external_partner_id: '1234' }
    taskRows = [
      { id: TASK_A, title: 'トップページ改修' },
      { id: TASK_B, title: '問い合わせフォーム' },
    ]
    pricingRows = [
      { task_id: TASK_A, sell_total: 120000 },
      { task_id: TASK_B, sell_total: 30000 },
    ]
    insertResult = { data: { id: 'doc-1' }, error: null }
    existingDocument = null
    createDocument.mockResolvedValue({
      externalId: 'ext-1',
      documentNumber: 'INV-001',
      status: 'issued',
      rawStatus: 'issue',
      totalAmount: 165000,
      webUrl: 'https://example.test/inv/1',
    })
  })

  it('未ログインは 401', async () => {
    authUser = null
    const res = await POST(req(VALID_BODY))
    expect(res.status).toBe(401)
  })

  it('閲覧者は発行できない（403）', async () => {
    membershipRole = 'viewer'
    const res = await POST(req(VALID_BODY))
    expect(res.status).toBe(403)
    expect(createDocument).not.toHaveBeenCalled()
  })

  it('ベンダーは発行できない（403）', async () => {
    membershipRole = 'vendor'
    const res = await POST(req(VALID_BODY))
    expect(res.status).toBe(403)
  })

  it('発行先の取引先が未設定なら 409（勝手に取引先を作らない）', async () => {
    partnerLink = null
    const res = await POST(req(VALID_BODY))
    expect(res.status).toBe(409)
    expect(createDocument).not.toHaveBeenCalled()
  })

  it('金額未入力のタスクが混ざっていたら 422 で止める（0円で出さない）', async () => {
    pricingRows = [{ task_id: TASK_A, sell_total: 120000 }]
    const res = await POST(req(VALID_BODY))
    const body = await res.json()

    expect(res.status).toBe(422)
    expect(body.taskTitles).toEqual(['問い合わせフォーム'])
    expect(createDocument).not.toHaveBeenCalled()
  })

  it('タスクが選ばれていなければ 400', async () => {
    const res = await POST(req({ ...VALID_BODY, taskIds: [] }))
    expect(res.status).toBe(400)
  })

  it('対応していない連携先は 400', async () => {
    const res = await POST(req({ ...VALID_BODY, provider: 'yayoi' }))
    expect(res.status).toBe(400)
  })

  it('正常時は書類を作り 201 を返す', async () => {
    const res = await POST(req(VALID_BODY))
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(createDocument).toHaveBeenCalledTimes(1)

    const [, docType, input, idempotencyKey] = createDocument.mock.calls[0]
    expect(docType).toBe('invoice')
    expect(input.partnerId).toBe('1234')
    expect(input.lines).toHaveLength(2)
    expect(input.lines[0]).toMatchObject({ name: 'トップページ改修', unitPrice: 120000, taxRate: 10 })
    // 冪等キーが外部にも渡っている（provider側が対応していれば二重発行をもう一段防げる）
    expect(typeof idempotencyKey).toBe('string')
    expect(idempotencyKey).toHaveLength(64)
    expect(body.document).toBeTruthy()
  })

  it('二度押しの2回目は外部APIを叩く前に止まり 409 を返す', async () => {
    insertResult = { data: null, error: { code: '23505' } }
    existingDocument = { id: 'doc-1', document_number: 'INV-001', status: 'issued' }

    const res = await POST(req(VALID_BODY))
    const body = await res.json()

    expect(res.status).toBe(409)
    // ここが要。記録が一意制約で弾かれた時点で外部発行に進んではいけない
    expect(createDocument).not.toHaveBeenCalled()
    expect(body.document).toMatchObject({ document_number: 'INV-001' })
  })

  it('外部で失敗したら 502 を返す（記録だけ残して再発行できなくならないようにする）', async () => {
    createDocument.mockRejectedValue(new Error('freee: APIエラー (500)'))

    const res = await POST(req(VALID_BODY))
    expect(res.status).toBe(502)
  })
})
