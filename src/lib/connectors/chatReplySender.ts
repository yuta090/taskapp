/**
 * チャット返信のポート(依存性注入の口)。契約 §4.1 (b) / §3-2。
 *
 * なぜポートか:
 *   完了(task.completed)をチャットへ返信するには「発生元チャットの解決 → 資格情報の復号 →
 *   送信アダプタ(deliverToChannel)呼び出し」が要る。これらは **secretary-channels ストリーム**の
 *   スキーマ/送信経路に属し、コネクタPR(このブランチ)からは直接 import できない
 *   (未マージ＋ストリーム分離ルール)。そこでコネクタ層は**チャネル層に一切依存しないポート**だけを
 *   持ち、実際の送信実装(ChatReplySender)は両ストリームが揃う場所で `registerChatReplySender` により
 *   注入する。未登録なら no-op(送るチャットが無い gtasks 起点タスク等も含め安全に素通り)。
 *
 * 本配線(将来・両ストリームが1ツリーに揃ったとき):
 *   `registerChatReplySender(async ({ taskRef, summary, artifactUrl, idempotencyKey }) => {
 *      // 1. taskRef から発生元チャット(channel/送信先 to/channel_accounts 資格情報)を解決
 *      //    発生元チャットが無ければ { delivered: false } を返す(gtasks 起点など)
 *      // 2. deliverToChannel(channel, { credentials, to, text, idempotencyKey }) を呼ぶ
 *      //    text = summary(無ければ既定文) + artifactUrl、idempotencyKey = 受信イベント event_id
 *      // 3. OutboundResult を ChatReplyResult へマップして返す
 *   })`
 *   をアプリ起動時に一度だけ呼ぶ。notifyChat 側の変更は不要(この関数が自動的に本番送信になる)。
 */

/** 送信要求(コネクタ層が知っている情報だけ。チャネルの概念は持ち込まない)。 */
export interface ChatReplyPayload {
  /** 完了したタスク(tasks.id)。送信側はこれから発生元チャットを解決する。 */
  taskRef: string
  /** multica が返した完了サマリ(無ければ null)。 */
  summary: string | null
  /** 成果物URL(無ければ null)。 */
  artifactUrl: string | null
  /** 冪等キー。受信イベントの event_id を渡す(送信側/アダプタで二重送信を弾くため)。 */
  idempotencyKey: string | null
}

/** 送信結果。**"送るチャットが無い" は失敗ではない**(delivered:false で正常)。 */
export interface ChatReplyResult {
  /** 実際にチャットへ送ったか。発生元チャットが無い/未対応なら false。 */
  delivered: boolean
}

export type ChatReplySender = (payload: ChatReplyPayload) => Promise<ChatReplyResult>

let _sender: ChatReplySender | null = null

/**
 * チャット返信の実装を登録する(両ストリームが揃う場所=アプリ起動時に一度だけ)。
 * null を渡すと解除(テスト用途)。
 */
export function registerChatReplySender(sender: ChatReplySender | null): void {
  _sender = sender
}

/** 現在登録されている送信実装。未登録なら null(= no-op)。 */
export function getChatReplySender(): ChatReplySender | null {
  return _sender
}
