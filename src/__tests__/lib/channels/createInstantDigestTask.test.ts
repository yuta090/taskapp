import { describe, it, expect, vi, beforeEach } from 'vitest'
import { formatDateToLocalString } from '@/lib/gantt/dateUtils'

/**
 * createInstantDigestTask（Stage 2.5 §2: メンション即時タスク化）
 *
 * channel_digest_tasks へ INSERT。extracted_date は JST日付
 * （formatDateToLocalString使用。toISOString().split禁止）。
 * unique(source_message_id, title) 競合は握って冪等成功('duplicate')扱い。
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chain(response: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {}
  builder.insert = vi.fn(() => builder)
  builder.select = vi.fn(() => builder)
  builder.single = vi.fn(() => Promise.resolve(response))
  return builder
}

let response: { data: unknown; error: unknown }
const fromMock = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ from: fromMock })),
}))

const { createInstantDigestTask } = await import('@/lib/channels/store')

beforeEach(() => {
  vi.clearAllMocks()
  response = { data: { id: 'task-9', title: '見積提出' }, error: null }
  fromMock.mockImplementation(() => chain(response))
})

describe('createInstantDigestTask', () => {
  it('groupからデノーマライズしたorg_id/space_idでINSERTし、extracted_dateはJST日付', async () => {
    const result = await createInstantDigestTask({
      orgId: 'org-1',
      groupId: 'group-1',
      spaceId: 'space-1',
      sourceMessageId: 'msg-1',
      title: '見積提出',
    })

    expect(result).toEqual({ id: 'task-9', title: '見積提出' })
    const builder = fromMock.mock.results[0].value
    expect(builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: 'org-1',
        group_id: 'group-1',
        space_id: 'space-1',
        source_message_id: 'msg-1',
        title: '見積提出',
        extracted_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      }),
    )
  })

  it('extracted_date は実行環境がUTCでもJST日付になる（1日ずれない）', async () => {
    // 2026-07-13T22:00:00Z = 2026-07-14 07:00 JST。UTC環境では naive だと 07-13 になる
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-13T22:00:00.000Z'))
    try {
      await createInstantDigestTask({
        orgId: 'org-1',
        groupId: 'group-1',
        spaceId: 'space-1',
        sourceMessageId: 'msg-jst',
        title: 'JST確認',
      })
      const builder = fromMock.mock.results[0].value
      expect(builder.insert).toHaveBeenCalledWith(
        expect.objectContaining({ extracted_date: '2026-07-14' }),
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('space_idがnullのグループ（未紐付け）でも作成できる', async () => {
    await createInstantDigestTask({
      orgId: 'org-1',
      groupId: 'group-1',
      spaceId: null,
      sourceMessageId: 'msg-2',
      title: '在庫確認',
    })
    const builder = fromMock.mock.results[0].value
    expect(builder.insert).toHaveBeenCalledWith(expect.objectContaining({ space_id: null }))
  })

  it('approverUserId 指定時は promotion_state=pending＋requested系を埋める（未通知で生む）', async () => {
    await createInstantDigestTask({
      orgId: 'org-1',
      groupId: 'group-1',
      spaceId: 'space-1',
      sourceMessageId: 'msg-3',
      title: '酒屋へ発注',
      approverUserId: 'approver-1',
    })
    const builder = fromMock.mock.results[0].value
    const arg = builder.insert.mock.calls[0][0]
    expect(arg.promotion_state).toBe('pending')
    expect(arg.requested_to_user_id).toBe('approver-1')
    // CHECK(digest_promotion_state_chk): pending は requested_at NOT NULL を要求する
    expect(typeof arg.requested_at).toBe('string')
    // 通知印は必ず claim RPC 側で原子的に打つ。生成時には積まない（未通知で生む）
    expect(arg).not.toHaveProperty('approval_notified_at')
  })

  it('approverUserId 未指定なら promotion 系は積まない（従来どおり none）', async () => {
    await createInstantDigestTask({
      orgId: 'org-1',
      groupId: 'group-1',
      spaceId: 'space-1',
      sourceMessageId: 'msg-4',
      title: '見積提出',
    })
    const arg = fromMock.mock.results[0].value.insert.mock.calls[0][0]
    expect(arg).not.toHaveProperty('promotion_state')
    expect(arg).not.toHaveProperty('requested_to_user_id')
  })

  it('unique(source_message_id, title)競合は冪等成功として duplicate を返す', async () => {
    response = { data: null, error: { code: '23505', message: 'duplicate key' } }
    fromMock.mockImplementation(() => chain(response))

    const result = await createInstantDigestTask({
      orgId: 'org-1',
      groupId: 'group-1',
      spaceId: 'space-1',
      sourceMessageId: 'msg-1',
      title: '見積提出',
    })
    expect(result).toBe('duplicate')
  })

  it('その他のDBエラーは例外を投げる', async () => {
    response = { data: null, error: { code: '99999', message: 'boom' } }
    fromMock.mockImplementation(() => chain(response))

    await expect(
      createInstantDigestTask({
        orgId: 'org-1',
        groupId: 'group-1',
        spaceId: null,
        sourceMessageId: 'msg-1',
        title: '見積提出',
      }),
    ).rejects.toThrow('boom')
  })
})
