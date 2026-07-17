import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * findExistingDigestTaskSourceMessageIds（フェーズ2・all_plus_instant の重複排除）:
 * 既に channel_digest_tasks に source_message_id が存在する発言IDを返す。
 * digest抽出候補からこれらを除外することで、即時タスク化済みの発言がLLM抽出で
 * 再度タスク化される（＝二重登録）のを防ぐ。
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chain(response: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {}
  for (const m of ['select', 'eq', 'in']) {
    builder[m] = vi.fn(() => builder)
  }
  builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(response).then(resolve)
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
  fromResponse = { data: [], error: null }
  fromMock.mockImplementation(() => chain(fromResponse))
})

describe('findExistingDigestTaskSourceMessageIds', () => {
  it('messageIds が空なら DB を呼ばずに空 Set を返す', async () => {
    const result = await store.findExistingDigestTaskSourceMessageIds('group-1', [])
    expect(result).toEqual(new Set())
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('既存の source_message_id を Set として返す', async () => {
    fromResponse = {
      data: [{ source_message_id: 'msg-1' }, { source_message_id: 'msg-3' }],
      error: null,
    }
    const result = await store.findExistingDigestTaskSourceMessageIds('group-1', [
      'msg-1',
      'msg-2',
      'msg-3',
    ])
    expect(result).toEqual(new Set(['msg-1', 'msg-3']))
  })

  it('group_id と source_message_id の in() でフィルタする', async () => {
    fromResponse = { data: [], error: null }
    await store.findExistingDigestTaskSourceMessageIds('group-1', ['msg-1', 'msg-2'])
    const call = fromMock.mock.results[0].value
    expect(call.eq).toHaveBeenCalledWith('group_id', 'group-1')
    expect(call.in).toHaveBeenCalledWith('source_message_id', ['msg-1', 'msg-2'])
  })

  it('DBエラーは例外を投げる（cron側で握って抽出をスキップする設計）', async () => {
    fromResponse = { data: null, error: { message: 'boom' } }
    await expect(
      store.findExistingDigestTaskSourceMessageIds('group-1', ['msg-1']),
    ).rejects.toThrow('boom')
  })
})
