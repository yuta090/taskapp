import { registerChatReplySender } from '@/lib/connectors/chatReplySender'
import { lineChatReplySender } from '@/lib/connectors/chatReplyLine'

/**
 * コネクタのチャット返信実装(lineChatReplySender)を DI ポートへ登録する(契約 §4.1 (b))。
 *
 * notifyChatOnCompletion は未登録だと no-op のため、実際に本番送信させるには一度だけ
 * registerChatReplySender を呼ぶ必要がある。Next.js には確実に一度だけ走る起動フックが無いため、
 * 受信 Webhook(= notifyChat が発火する唯一の経路)のハンドラ先頭で本関数を呼ぶ。冪等ガードで
 * 多重登録を避ける(登録は単なる代入なので実害は無いが、意図を明示する)。
 */
let _registered = false

export function ensureConnectorChatReplyRegistered(): void {
  if (_registered) return
  registerChatReplySender(lineChatReplySender)
  _registered = true
}
