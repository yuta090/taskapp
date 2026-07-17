import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * getOrgChannelPolicyState — org_channel_policy(state, on_exceed) の読み取り（PR4メータリング）。
 *
 * 明示行の無い org は「暗黙 ok/none」（送信境界がcoalesceする前提。org_channel_policyの
 * 検証コメント §1参照）。DBエラーは例外を投げ、暗黙okと区別する。
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chain(response: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {}
  for (const m of ['select', 'eq']) {
    builder[m] = vi.fn(() => builder)
  }
  builder.maybeSingle = vi.fn(() => Promise.resolve(response))
  return builder
}

let fromResponse: unknown
const fromMock = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ from: fromMock })),
}))

const store = await import('@/lib/channels/store')

beforeEach(() => {
  vi.clearAllMocks()
  fromMock.mockImplementation(() => chain(fromResponse))
})

describe('getOrgChannelPolicyState', () => {
  it('行があればstate/on_exceedをそのまま返す', async () => {
    fromResponse = { data: { state: 'soft', on_exceed: 'degrade' }, error: null }
    expect(await store.getOrgChannelPolicyState('org-1')).toEqual({ state: 'soft', onExceed: 'degrade' })
  })

  it('行が無いorgは暗黙 ok/none', async () => {
    fromResponse = { data: null, error: null }
    expect(await store.getOrgChannelPolicyState('org-1')).toEqual({ state: 'ok', onExceed: 'none' })
  })

  it('DBエラーは例外を投げる（暗黙okの成功と区別する）', async () => {
    fromResponse = { data: null, error: { message: 'boom' } }
    await expect(store.getOrgChannelPolicyState('org-1')).rejects.toThrow('boom')
  })
})
