import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  registerChatReplySender,
  getChatReplySender,
  type ChatReplySender,
} from '@/lib/connectors/chatReplySender'

describe('chatReplySender port', () => {
  beforeEach(() => {
    registerChatReplySender(null)
  })

  it('未登録なら getChatReplySender は null(= no-op)', () => {
    expect(getChatReplySender()).toBeNull()
  })

  it('登録した実装が取得でき、payloadを受け取れる', async () => {
    const sender: ChatReplySender = vi.fn(async () => ({ delivered: true }))
    registerChatReplySender(sender)

    const got = getChatReplySender()
    expect(got).toBe(sender)

    const result = await got!({
      taskRef: 'task-1',
      summary: '完了しました',
      artifactUrl: null,
      idempotencyKey: 'evt-1',
    })
    expect(result).toEqual({ delivered: true })
    expect(sender).toHaveBeenCalledWith({
      taskRef: 'task-1',
      summary: '完了しました',
      artifactUrl: null,
      idempotencyKey: 'evt-1',
    })
  })

  it('null 登録で解除できる', () => {
    registerChatReplySender(vi.fn(async () => ({ delivered: false })))
    expect(getChatReplySender()).not.toBeNull()
    registerChatReplySender(null)
    expect(getChatReplySender()).toBeNull()
  })
})
