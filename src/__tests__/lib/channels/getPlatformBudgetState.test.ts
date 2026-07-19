import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * getPlatformBudgetState — platform_channel_budget(state) の読み取り
 * （共有bot(共通LINE)グローバル予算層・fable確定設計）。
 *
 * getOrgChannelPolicyState（org層）とは fail 方向が異なる:
 *   - 行が無い account（未プロビジョニング）は「暗黙 ok」（cronの自動プロビジョニングが
 *     追いつく前の一時的な状態であり、まだ集計対象になっていないだけ）。
 *   - DBエラーは fail-closed で 'hard' を返す（例外は投げない）。グローバル予算は
 *     「当社が守るべきLINEアカウントの実物理上限」であり、読めない時は緩める(ok)より
 *     止める(hard)側に倒す方が安全。org層(getOrgChannelPolicyState)は例外を投げて
 *     呼出側にエラーとして伝播させる設計だが、こちらは呼出側が確実に抑止できるよう
 *     値として返す。
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

describe('getPlatformBudgetState', () => {
  it('行があればstateをそのまま返す', async () => {
    fromResponse = { data: { state: 'soft' }, error: null }
    expect(await store.getPlatformBudgetState('acc-1')).toBe('soft')
  })

  it('行があればhardもそのまま返す', async () => {
    fromResponse = { data: { state: 'hard' }, error: null }
    expect(await store.getPlatformBudgetState('acc-1')).toBe('hard')
  })

  it('行が無いaccountは暗黙ok（未プロビジョニングの一時状態）', async () => {
    fromResponse = { data: null, error: null }
    expect(await store.getPlatformBudgetState('acc-1')).toBe('ok')
  })

  it('DBエラーはfail-closedでhardを返す（例外は投げない）', async () => {
    fromResponse = { data: null, error: { message: 'boom' } }
    expect(await store.getPlatformBudgetState('acc-1')).toBe('hard')
  })
})
