import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * findChatOriginGroupForTask: 完了した本体タスク(tasks.id)の発生元チャットグループを
 * channel_digest_tasks.promoted_task_id 逆引き(promotion_state='promoted')で解決する。
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chain(response: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {}
  for (const m of ['select', 'eq', 'limit']) {
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
  fromResponse = { data: null, error: null }
  fromMock.mockImplementation(() => chain(fromResponse))
})

describe('findChatOriginGroupForTask', () => {
  it('promoted な digest 行があれば {groupId, orgId} を返す', async () => {
    fromResponse = { data: { group_id: 'g-1', org_id: 'o-1' }, error: null }
    const r = await store.findChatOriginGroupForTask('task-1')
    expect(r).toEqual({ groupId: 'g-1', orgId: 'o-1' })
  })

  it('該当行が無ければ null(発生元チャット無し)', async () => {
    fromResponse = { data: null, error: null }
    expect(await store.findChatOriginGroupForTask('task-x')).toBeNull()
  })

  it('promoted_task_id と promotion_state=promoted でフィルタする', async () => {
    fromResponse = { data: null, error: null }
    await store.findChatOriginGroupForTask('task-7')
    const call = fromMock.mock.results[0].value
    expect(fromMock).toHaveBeenCalledWith('channel_digest_tasks')
    expect(call.eq).toHaveBeenCalledWith('promoted_task_id', 'task-7')
    expect(call.eq).toHaveBeenCalledWith('promotion_state', 'promoted')
  })

  it('DBエラーは throw する', async () => {
    fromResponse = { data: null, error: { message: 'boom' } }
    await expect(store.findChatOriginGroupForTask('task-1')).rejects.toThrow(/origin lookup failed/)
  })
})
