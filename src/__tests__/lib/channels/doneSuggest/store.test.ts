import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * task_done_suggestions 台帳の書き込み層。
 * insertDoneSuggestion: on conflict(task_id) do nothing の「送信勝者のみpush」を
 *   upsert+ignoreDuplicates+select で実現しているか（inserted=true/false）。
 * markDoneSuggestionConfirmed/Dismissed: ベストエフォート更新・authz(本人一致)。
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chain(response: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {
    upsert: vi.fn(() => builder),
    update: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    select: vi.fn(() => builder),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(response).then(resolve, reject),
  }
  return builder
}

let response: unknown
const fromMock = vi.fn()
const rpcMock = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ from: fromMock, rpc: rpcMock })),
}))

const store = await import('@/lib/channels/doneSuggest/store')

beforeEach(() => {
  vi.clearAllMocks()
  response = { data: [], error: null }
  fromMock.mockImplementation(() => chain(response))
})

describe('insertDoneSuggestion', () => {
  it('新規insertされたら inserted:true', async () => {
    response = { data: [{ id: 'row-1' }], error: null }
    const r = await store.insertDoneSuggestion({
      taskId: 'task-1',
      channelGroupId: 'group-1',
      triggerMessageId: 'msg-1',
      suggestedToUserId: 'user-1',
    })
    expect(r).toEqual({ inserted: true })
  })

  it('既に台帳がある(conflict)なら inserted:false（0行）', async () => {
    response = { data: [], error: null }
    const r = await store.insertDoneSuggestion({
      taskId: 'task-1',
      channelGroupId: 'group-1',
      triggerMessageId: 'msg-1',
      suggestedToUserId: 'user-1',
    })
    expect(r).toEqual({ inserted: false })
  })

  it('upsertはonConflict:task_id, ignoreDuplicates:trueで呼ぶ', async () => {
    response = { data: [], error: null }
    await store.insertDoneSuggestion({
      taskId: 'task-1',
      channelGroupId: null,
      triggerMessageId: null,
      suggestedToUserId: null,
    })
    const call = fromMock.mock.results[0].value
    expect(fromMock).toHaveBeenCalledWith('task_done_suggestions')
    expect(call.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ task_id: 'task-1' }),
      { onConflict: 'task_id', ignoreDuplicates: true },
    )
  })

  it('DBエラーはthrowする', async () => {
    response = { data: null, error: { message: 'boom' } }
    await expect(
      store.insertDoneSuggestion({
        taskId: 'task-1',
        channelGroupId: null,
        triggerMessageId: null,
        suggestedToUserId: null,
      }),
    ).rejects.toThrow(/insert failed/)
  })
})

describe('markDoneSuggestionConfirmed', () => {
  it('task_idで更新する（現在のstatusは問わない）', async () => {
    response = { data: [{ id: 'row-1' }], error: null }
    await store.markDoneSuggestionConfirmed('task-1')
    const call = fromMock.mock.results[0].value
    expect(call.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'confirmed' }),
    )
    expect(call.eq).toHaveBeenCalledWith('task_id', 'task-1')
  })

  it('台帳行が無くても（0行）静かに終わる', async () => {
    response = { data: [], error: null }
    await expect(store.markDoneSuggestionConfirmed('task-x')).resolves.toBeUndefined()
  })

  it('DBエラーはthrowする', async () => {
    response = { data: null, error: { message: 'boom' } }
    await expect(store.markDoneSuggestionConfirmed('task-1')).rejects.toThrow(/mark confirmed failed/)
  })
})

describe('markDoneSuggestionDismissed', () => {
  it('本人(suggested_to_user_id一致)かつstatus=sentの行を更新できたらtrue', async () => {
    response = { data: [{ id: 'row-1' }], error: null }
    const r = await store.markDoneSuggestionDismissed('task-1', 'user-1')
    expect(r).toBe(true)
  })

  it('対象行が無ければfalse（別人/既に処理済み/行なし）', async () => {
    response = { data: [], error: null }
    const r = await store.markDoneSuggestionDismissed('task-1', 'user-1')
    expect(r).toBe(false)
  })

  it('task_id・suggested_to_user_id・status=sentでフィルタする', async () => {
    response = { data: [], error: null }
    await store.markDoneSuggestionDismissed('task-1', 'user-1')
    const call = fromMock.mock.results[0].value
    expect(call.eq).toHaveBeenCalledWith('task_id', 'task-1')
    expect(call.eq).toHaveBeenCalledWith('suggested_to_user_id', 'user-1')
    expect(call.eq).toHaveBeenCalledWith('status', 'sent')
  })

  it('DBエラーはthrowする', async () => {
    response = { data: null, error: { message: 'boom' } }
    await expect(store.markDoneSuggestionDismissed('task-1', 'user-1')).rejects.toThrow(
      /mark dismissed failed/,
    )
  })
})

describe('isTaskVisibleToActor', () => {
  it('app_task_visible_to_actorがtrueを返せばtrue', async () => {
    rpcMock.mockResolvedValue({ data: true, error: null })
    const r = await store.isTaskVisibleToActor('task-1', 'user-1')
    expect(r).toBe(true)
    expect(rpcMock).toHaveBeenCalledWith('app_task_visible_to_actor', {
      p_task_id: 'task-1',
      p_actor: 'user-1',
    })
  })

  it('app_task_visible_to_actorがfalseを返せばfalse（別space等で不可視）', async () => {
    rpcMock.mockResolvedValue({ data: false, error: null })
    const r = await store.isTaskVisibleToActor('task-1', 'user-1')
    expect(r).toBe(false)
  })

  it('DBエラーはfail-closed（false）で返す（例外にしない・呼び出し側は沈黙するだけで安全）', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'boom' } })
    const r = await store.isTaskVisibleToActor('task-1', 'user-1')
    expect(r).toBe(false)
  })
})
