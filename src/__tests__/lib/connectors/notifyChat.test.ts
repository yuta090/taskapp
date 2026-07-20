import { describe, it, expect, beforeEach, vi } from 'vitest'
import { notifyChatOnCompletion } from '@/lib/connectors/notifyChat'
import { registerChatReplySender, type ChatReplySender } from '@/lib/connectors/chatReplySender'

describe('notifyChatOnCompletion', () => {
  beforeEach(() => {
    registerChatReplySender(null)
    vi.clearAllMocks()
  })

  it('sender未登録なら no-op(例外を投げず素通り)', async () => {
    await expect(
      notifyChatOnCompletion('task-1', { summary: 'done', artifactUrl: null }, 'evt-1'),
    ).resolves.toBeUndefined()
  })

  it('登録済み sender に payload(idempotencyKey=event_id 含む)を委譲する', async () => {
    const sender: ChatReplySender = vi.fn(async () => ({ delivered: true }))
    registerChatReplySender(sender)

    await notifyChatOnCompletion(
      'task-1',
      { summary: '完了しました', artifactUrl: 'https://x/y' },
      'evt-42',
    )

    expect(sender).toHaveBeenCalledWith({
      taskRef: 'task-1',
      summary: '完了しました',
      artifactUrl: 'https://x/y',
      idempotencyKey: 'evt-42',
    })
  })

  it('delivered:false(返信対象のチャット無し)でも例外にならない', async () => {
    registerChatReplySender(async () => ({ delivered: false }))
    await expect(
      notifyChatOnCompletion('task-1', { summary: null, artifactUrl: null }, null),
    ).resolves.toBeUndefined()
  })

  it('sender が投げた例外はそのまま伝播する(呼び出し側 propagateTaskCompleted が握る前提)', async () => {
    registerChatReplySender(async () => {
      throw new Error('transient send error')
    })
    await expect(
      notifyChatOnCompletion('task-1', { summary: 'x', artifactUrl: null }, 'evt-1'),
    ).rejects.toThrow('transient send error')
  })
})
