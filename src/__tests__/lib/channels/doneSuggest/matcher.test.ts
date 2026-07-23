import { describe, it, expect, vi, beforeEach } from 'vitest'
import { pickSingleOpenTask } from '@/lib/channels/doneSuggest/matcher'

/**
 * findOpenPromotedTaskForGroup: 発生元グループの未完了promotedタスクが
 * ちょうど1件のときだけ返す（0件/2件以上は沈黙=null）。
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chain(response: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    neq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    not: vi.fn(() => builder),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(response).then(resolve, reject),
  }
  return builder
}

const fromMock = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ from: fromMock })),
}))

const { findOpenPromotedTaskForGroup } = await import('@/lib/channels/doneSuggest/matcher')

let digestResponse: unknown
let tasksResponse: unknown

beforeEach(() => {
  vi.clearAllMocks()
  digestResponse = { data: [], error: null }
  tasksResponse = { data: [], error: null }
  fromMock.mockImplementation((table: string) => {
    if (table === 'channel_digest_tasks') return chain(digestResponse)
    if (table === 'tasks') return chain(tasksResponse)
    throw new Error(`unexpected table: ${table}`)
  })
})

describe('pickSingleOpenTask（純関数）', () => {
  it('0件はnull', () => {
    expect(pickSingleOpenTask([])).toBeNull()
  })

  it('1件はそのタスクを返す', () => {
    expect(pickSingleOpenTask([{ id: 't-1', title: '見積書送付' }])).toEqual({
      taskId: 't-1',
      title: '見積書送付',
    })
  })

  it('2件以上はnull（曖昧・沈黙）', () => {
    expect(
      pickSingleOpenTask([
        { id: 't-1', title: 'A' },
        { id: 't-2', title: 'B' },
      ]),
    ).toBeNull()
  })
})

describe('findOpenPromotedTaskForGroup', () => {
  it('promotedタスクが0件ならnull', async () => {
    digestResponse = { data: [], error: null }
    const r = await findOpenPromotedTaskForGroup('group-1')
    expect(r).toBeNull()
  })

  it('未完了タスクがちょうど1件なら返す', async () => {
    digestResponse = { data: [{ promoted_task_id: 'task-1' }], error: null }
    tasksResponse = { data: [{ id: 'task-1', title: '見積書送付' }], error: null }
    const r = await findOpenPromotedTaskForGroup('group-1')
    expect(r).toEqual({ taskId: 'task-1', title: '見積書送付' })
  })

  it('未完了タスクが2件以上ならnull（曖昧・沈黙）', async () => {
    digestResponse = {
      data: [{ promoted_task_id: 'task-1' }, { promoted_task_id: 'task-2' }],
      error: null,
    }
    tasksResponse = {
      data: [
        { id: 'task-1', title: 'A' },
        { id: 'task-2', title: 'B' },
      ],
      error: null,
    }
    const r = await findOpenPromotedTaskForGroup('group-1')
    expect(r).toBeNull()
  })

  it('promoted_task_idはあるが該当タスクが全て完了済み(status=done)なら0件→null', async () => {
    digestResponse = { data: [{ promoted_task_id: 'task-1' }], error: null }
    tasksResponse = { data: [], error: null } // neq('status','done')で絞られ0行
    const r = await findOpenPromotedTaskForGroup('group-1')
    expect(r).toBeNull()
  })

  it('重複したpromoted_task_idはSetで畳んでから件数判定する', async () => {
    digestResponse = {
      data: [{ promoted_task_id: 'task-1' }, { promoted_task_id: 'task-1' }],
      error: null,
    }
    tasksResponse = { data: [{ id: 'task-1', title: '見積書送付' }], error: null }
    const r = await findOpenPromotedTaskForGroup('group-1')
    expect(r).toEqual({ taskId: 'task-1', title: '見積書送付' })
  })

  it('group_id/promotion_stateでフィルタする', async () => {
    digestResponse = { data: [], error: null }
    await findOpenPromotedTaskForGroup('group-7')
    const digestCall = fromMock.mock.results[0].value
    expect(fromMock).toHaveBeenCalledWith('channel_digest_tasks')
    expect(digestCall.eq).toHaveBeenCalledWith('group_id', 'group-7')
    expect(digestCall.eq).toHaveBeenCalledWith('promotion_state', 'promoted')
  })

  it('channel_digest_tasksのDBエラーはthrowする', async () => {
    digestResponse = { data: null, error: { message: 'boom' } }
    await expect(findOpenPromotedTaskForGroup('group-1')).rejects.toThrow(/open task lookup failed/)
  })

  it('tasksのDBエラーはthrowする', async () => {
    digestResponse = { data: [{ promoted_task_id: 'task-1' }], error: null }
    tasksResponse = { data: null, error: { message: 'boom' } }
    await expect(findOpenPromotedTaskForGroup('group-1')).rejects.toThrow(/open task lookup failed/)
  })
})
