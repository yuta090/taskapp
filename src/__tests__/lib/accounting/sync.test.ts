import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 入金取り込みの回帰テスト。
 *
 * 一番守りたいのは「分からない状態で、分かっている状態を潰さない」こと。
 * 発行済みが不明に戻ると、督促するかどうかの判断材料が消える。
 */

let pendingRows: Array<Record<string, unknown>>
const updates: Array<{ id: string; patch: Record<string, unknown> }> = []
const getDocument = vi.fn()
let connectionStatus: 'ok' | 'auth_failed' = 'ok'

function chain(result: unknown) {
  const obj: Record<string, unknown> = {}
  for (const m of ['select', 'in', 'not', 'or', 'order', 'limit', 'eq']) {
    obj[m] = vi.fn(() => obj)
  }
  obj.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return obj
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn(() => {
      const node: Record<string, unknown> = {}
      node.select = vi.fn(() => chain({ data: pendingRows, error: null }))
      node.update = vi.fn((patch: Record<string, unknown>) => ({
        eq: vi.fn((_col: string, id: string) => {
          updates.push({ id, patch })
          return Promise.resolve({ data: null, error: null })
        }),
      }))
      return node
    }),
  })),
}))

vi.mock('@/lib/accounting/connection', () => ({
  resolveAccountingConnection: vi.fn(() =>
    Promise.resolve(
      connectionStatus === 'ok'
        ? { status: 'ok', connectionId: 'c1', adapter: { getDocument }, ctx: { credentials: { token: 't' } } }
        : { status: 'auth_failed' },
    ),
  ),
  connectionErrorResponse: () => ({ error: 'x', httpStatus: 409 }),
}))

const { syncBillingDocumentsBatch } = await import('@/lib/accounting/sync')

const NOW = new Date('2026-07-31T09:00:00Z')

describe('syncBillingDocumentsBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    updates.length = 0
    connectionStatus = 'ok'
    pendingRows = [
      { id: 'doc-1', org_id: 'org-1', provider: 'freee', doc_type: 'invoice', external_id: 'ext-1', status: 'issued' },
    ]
  })

  it('入金済みになっていたら取り込む', async () => {
    getDocument.mockResolvedValue({
      externalId: 'ext-1',
      documentNumber: 'INV-001',
      status: 'paid',
      rawStatus: 'paid',
      totalAmount: 165000,
      webUrl: 'https://example.test/1',
    })

    const summary = await syncBillingDocumentsBatch(NOW)

    expect(summary).toEqual({ checked: 1, updated: 1, failed: 0 })
    expect(updates[0].patch.status).toBe('paid')
    expect(updates[0].patch.remote_synced_at).toBe(NOW.toISOString())
  })

  it('畳めない状態(unknown)で既知の状態を上書きしない', async () => {
    getDocument.mockResolvedValue({
      externalId: 'ext-1',
      documentNumber: null,
      status: 'unknown',
      rawStatus: '見たことのない状態',
      totalAmount: null,
      webUrl: null,
    })

    const summary = await syncBillingDocumentsBatch(NOW)

    // status は patch に入れない＝'issued' のまま残る
    expect('status' in updates[0].patch).toBe(false)
    // ただし生の値と確認時刻は残す（後から畳み方を直すため）
    expect(updates[0].patch.raw_status).toBe('見たことのない状態')
    expect(summary.updated).toBe(0)
  })

  it('状態が変わっていなければ更新件数に数えない', async () => {
    getDocument.mockResolvedValue({
      externalId: 'ext-1',
      documentNumber: 'INV-001',
      status: 'issued',
      rawStatus: 'issue',
      totalAmount: 165000,
      webUrl: null,
    })

    const summary = await syncBillingDocumentsBatch(NOW)
    expect(summary.updated).toBe(0)
    expect(summary.checked).toBe(1)
  })

  it('1件が失敗しても残りを続ける（1つの不調で全体を止めない）', async () => {
    pendingRows = [
      { id: 'doc-1', org_id: 'org-1', provider: 'freee', doc_type: 'invoice', external_id: 'e1', status: 'issued' },
      { id: 'doc-2', org_id: 'org-1', provider: 'freee', doc_type: 'invoice', external_id: 'e2', status: 'issued' },
    ]
    getDocument
      .mockRejectedValueOnce(new Error('freee: APIエラー (500)'))
      .mockResolvedValueOnce({
        externalId: 'e2',
        documentNumber: 'INV-002',
        status: 'paid',
        rawStatus: 'paid',
        totalAmount: 1000,
        webUrl: null,
      })

    const summary = await syncBillingDocumentsBatch(NOW)

    expect(summary).toEqual({ checked: 2, updated: 1, failed: 1 })
    // 失敗した1件も確認時刻を進める。進めないと毎回先頭に居座り後続が確認されない
    const failedUpdate = updates.find((u) => u.id === 'doc-1')
    expect(failedUpdate?.patch.remote_synced_at).toBe(NOW.toISOString())
  })

  it('接続が失効していたら失敗として数え、書類は触らない', async () => {
    connectionStatus = 'auth_failed'

    const summary = await syncBillingDocumentsBatch(NOW)

    expect(summary).toEqual({ checked: 1, updated: 0, failed: 1 })
    expect(updates).toHaveLength(0)
    expect(getDocument).not.toHaveBeenCalled()
  })

  it('対象が無ければ何もしない', async () => {
    pendingRows = []
    const summary = await syncBillingDocumentsBatch(NOW)
    expect(summary).toEqual({ checked: 0, updated: 0, failed: 0 })
  })
})
