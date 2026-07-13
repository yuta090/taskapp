import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * reopenDigestTaskAtomic（Stage 2.5 §3-2: 完了の取り消し）
 *
 * update channel_digest_tasks
 * set status='open', done_at=null, done_via=null, done_by_external_user_id=null
 * where id=? and status='done' and done_at > now()-interval '24 hours'
 * returning id, title
 *
 * 0行なら「取り消せない」（既にopen/dismissed、または24時間超過）。
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chain(response: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {}
  for (const m of ['select', 'eq', 'gt', 'update']) {
    builder[m] = vi.fn(() => builder)
  }
  builder.maybeSingle = vi.fn(() => Promise.resolve(response))
  return builder
}

let response: { data: unknown; error: unknown }
const fromMock = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ from: fromMock })),
}))

const { reopenDigestTaskAtomic } = await import('@/lib/channels/store')

const TASK_ID = 'task-1'

beforeEach(() => {
  vi.clearAllMocks()
  response = { data: { id: TASK_ID, title: '酒屋へ発注' }, error: null }
  fromMock.mockImplementation(() => chain(response))
})

describe('reopenDigestTaskAtomic', () => {
  it('24時間以内のdoneタスクを原子的にopenへ戻す', async () => {
    const result = await reopenDigestTaskAtomic(TASK_ID)
    expect(result).toEqual({ id: TASK_ID, title: '酒屋へ発注' })

    const builder = fromMock.mock.results[0].value
    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'open',
        done_at: null,
        done_via: null,
        done_by_external_user_id: null,
      }),
    )
    expect(builder.eq).toHaveBeenCalledWith('id', TASK_ID)
    expect(builder.eq).toHaveBeenCalledWith('status', 'done')
    expect(builder.gt).toHaveBeenCalledWith('done_at', expect.any(String))
  })

  it('0行（24時間超過・既にopen等）なら null を返す', async () => {
    response = { data: null, error: null }
    fromMock.mockImplementation(() => chain(response))
    const result = await reopenDigestTaskAtomic(TASK_ID)
    expect(result).toBeNull()
  })

  it('DBエラーなら null を返す', async () => {
    response = { data: null, error: { message: 'boom' } }
    fromMock.mockImplementation(() => chain(response))
    const result = await reopenDigestTaskAtomic(TASK_ID)
    expect(result).toBeNull()
  })
})
