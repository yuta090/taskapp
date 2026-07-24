import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * linkIdentityViaCode の channel 引数（WhatsApp DM紐付け床）。
 *
 * 突合コード（channel_link_codes）はチャネル横断 — 発行済みの1コードがLINEでも
 * WhatsAppでも通り、償還したチャネルで identity を作る。findValidLinkCode は
 * チャネル無関係のまま変更しない。linkIdentityViaCode に「作る identity の channel」を
 * 引数で渡すだけ（既定 'line' で既存呼び出し元の挙動は不変）。
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function insertChain(response: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {}
  for (const m of ['insert', 'select', 'eq']) {
    builder[m] = vi.fn(() => builder)
  }
  builder.single = vi.fn(() => Promise.resolve(response))
  return builder
}

let insertResponse: unknown
let selectResponse: unknown
const fromMock = vi.fn()
let capturedInsertBuilder: ReturnType<typeof insertChain> | null = null
let capturedSelectBuilder: ReturnType<typeof insertChain> | null = null

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ from: fromMock })),
}))

const store = await import('@/lib/channels/store')

const LINK_CODE = {
  id: 'lc-1',
  orgId: 'org-1',
  spaceId: 'space-1',
  firstUsedAt: '2026-07-01T00:00:00.000Z', // 既に使用済み → first_used_at 更新の分岐を通らない
}

beforeEach(() => {
  vi.clearAllMocks()
  insertResponse = { data: { id: 'idn-1', space_id: 'space-1' }, error: null }
  selectResponse = { data: null, error: null }
  let call = 0
  fromMock.mockImplementation((table: string) => {
    if (table !== 'channel_identities') throw new Error(`unexpected table: ${table}`)
    call += 1
    if (call === 1) {
      capturedInsertBuilder = insertChain(insertResponse)
      return capturedInsertBuilder
    }
    capturedSelectBuilder = insertChain(selectResponse)
    return capturedSelectBuilder
  })
})

describe('linkIdentityViaCode', () => {
  it('channel を渡すとその channel で identity を作る(whatsapp)', async () => {
    const identity = await store.linkIdentityViaCode(LINK_CODE, '81901234567', 'whatsapp')

    expect(identity).toEqual({ id: 'idn-1', spaceId: 'space-1' })
    expect(capturedInsertBuilder!.insert).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'whatsapp', external_id: '81901234567' }),
    )
  })

  it('channel 省略時は既定で line のまま(既存呼び出し元の挙動不変)', async () => {
    await store.linkIdentityViaCode(LINK_CODE, 'U-1')

    expect(capturedInsertBuilder!.insert).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'line' }),
    )
  })

  it('23505衝突時は同じ channel で既存activeを検索する', async () => {
    insertResponse = { data: null, error: { code: '23505', message: 'duplicate' } }
    selectResponse = { data: { id: 'idn-existing', space_id: 'space-1' }, error: null }

    const identity = await store.linkIdentityViaCode(LINK_CODE, '81901234567', 'whatsapp')

    expect(identity).toEqual({ id: 'idn-existing', spaceId: 'space-1' })
    expect(capturedSelectBuilder!.eq).toHaveBeenCalledWith('channel', 'whatsapp')
  })
})
