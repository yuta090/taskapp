import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * findChannelAccountMetaForOrgChannel(orgId, channel) — 「つなぐ」画面の接続状態表示用。
 *
 * 登録側(findReusableOrgChannelAccountId)と同じ行を選ぶこと:
 * 自社の口(owner_type='org')だけ・有効を優先・新しい順。無効な古い行を「接続済み」と出さない。
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chain(response: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {}
  for (const m of ['select', 'eq', 'order', 'limit']) {
    builder[m] = vi.fn(() => builder)
  }
  builder.maybeSingle = vi.fn(() => Promise.resolve(response))
  return builder
}

let lastBuilder: ReturnType<typeof chain> | null = null
const fromMock = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ from: fromMock })),
}))

const store = await import('@/lib/channels/store')

const ROW = {
  id: 'acc-slack',
  org_id: 'org-1',
  channel: 'slack',
  display_name: 'AgentPM秘書',
  line_bot_user_id: null,
  status: 'active',
  created_at: '2026-09-07T00:00:00Z',
  owner_type: 'org',
}

beforeEach(() => {
  vi.clearAllMocks()
  fromMock.mockImplementation(() => {
    lastBuilder = chain({ data: ROW, error: null })
    return lastBuilder
  })
})

describe('findChannelAccountMetaForOrgChannel', () => {
  it('channel と owner_type=org で絞り、有効を優先・新しい順で1件選ぶ', async () => {
    const meta = await store.findChannelAccountMetaForOrgChannel('org-1', 'slack')
    expect(meta?.channel).toBe('slack')
    expect(lastBuilder!.eq).toHaveBeenCalledWith('org_id', 'org-1')
    expect(lastBuilder!.eq).toHaveBeenCalledWith('channel', 'slack')
    expect(lastBuilder!.eq).toHaveBeenCalledWith('owner_type', 'org')
    expect(lastBuilder!.order).toHaveBeenCalledWith('status', { ascending: true })
    expect(lastBuilder!.order).toHaveBeenCalledWith('created_at', { ascending: false })
  })

  it('従来の findChannelAccountMetaForOrg(orgId) は挙動不変（LINE の秘書コンソール互換）', async () => {
    await store.findChannelAccountMetaForOrg('org-1')
    expect(lastBuilder!.eq).toHaveBeenCalledTimes(1)
    expect(lastBuilder!.eq).toHaveBeenCalledWith('org_id', 'org-1')
  })
})
