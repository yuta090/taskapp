import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * ensureConnectorChatReplyRegistered: 完了返信の実装(lineChatReplySender)を DI ポートへ
 * 一度だけ登録する。登録後は getChatReplySender が実装を返し、notifyChat が本番送信になる。
 */

const registerChatReplySender = vi.fn()
vi.mock('@/lib/connectors/chatReplySender', () => ({
  registerChatReplySender: (...a: unknown[]) => registerChatReplySender(...a),
}))

const lineChatReplySender = vi.fn()
vi.mock('@/lib/connectors/chatReplyLine', () => ({
  lineChatReplySender: (...a: unknown[]) => lineChatReplySender(...a),
}))

const { ensureConnectorChatReplyRegistered } = await import('@/lib/connectors/chatReplyBootstrap')

beforeEach(() => {
  registerChatReplySender.mockClear()
})

describe('ensureConnectorChatReplyRegistered', () => {
  it('lineChatReplySender を DI ポートへ登録する', () => {
    ensureConnectorChatReplyRegistered()
    expect(registerChatReplySender).toHaveBeenCalledTimes(1)
    // 登録された関数は lineChatReplySender(モジュール参照)であること
    const registered = registerChatReplySender.mock.calls[0][0]
    registered('x')
    expect(lineChatReplySender).toHaveBeenCalledWith('x')
  })

  it('冪等: 複数回呼んでも登録は一度だけ', () => {
    ensureConnectorChatReplyRegistered()
    ensureConnectorChatReplyRegistered()
    ensureConnectorChatReplyRegistered()
    // モジュールの _registered ガードにより beforeEach 後の追加登録は起きない
    expect(registerChatReplySender).not.toHaveBeenCalled()
  })
})
