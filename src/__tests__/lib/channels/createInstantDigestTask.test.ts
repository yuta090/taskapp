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
        extracted_date: formatDateToLocalString(new Date()),
      }),
    )
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
