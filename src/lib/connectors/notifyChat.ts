import { getChatReplySender } from '@/lib/connectors/chatReplySender'

/**
 * multica の完了(task.completed)をチャットへ返信する(契約 §4.1 (b) / §3-2)。
 *
 * 実際の送信(発生元チャット解決 → 資格情報復号 → deliverToChannel)は secretary-channels
 * ストリーム側の責務で、コネクタPRからは直接 import できない。そのため本関数は
 * **チャネル層非依存のポート(`chatReplySender`)へ委譲するだけ**にする:
 *   - 送信実装が `registerChatReplySender` で登録済みなら、それに委譲する(本番送信)。
 *   - 未登録なら no-op(ログのみ)。送るチャットが無い gtasks 起点タスクでも安全に素通りする。
 * これにより両ストリームが1ツリーに揃った時、`registerChatReplySender(...)` を一箇所呼ぶだけで
 * 本関数が自動的に本番送信になる(この関数の再変更は不要)。
 *
 * 呼び出し規約(inbound の propagateTaskCompleted):
 *   - 本関数は**真の0→1遷移のときだけ**呼ばれる(再送での二重送信を避けるゲート)。
 *   - 失敗は呼び出し側が握ってログのみ=ベストエフォート(DB上の完了確定は巻き戻さない)。
 *   - idempotencyKey には受信イベントの event_id を渡す(送信側/アダプタで二重送信を弾く土台)。
 */

export interface MulticaCompletionResult {
  summary: string | null
  artifactUrl: string | null
}

export async function notifyChatOnCompletion(
  taskRef: string,
  result: MulticaCompletionResult,
  idempotencyKey: string | null = null,
): Promise<void> {
  const sender = getChatReplySender()
  if (!sender) {
    // 送信実装が未登録(secretary-channels 統合前 / この環境では送信経路なし)。no-op。
    console.log('[connectors] notifyChatOnCompletion: sender未登録のため送信スキップ', { taskRef })
    return
  }

  const { delivered } = await sender({
    taskRef,
    summary: result.summary,
    artifactUrl: result.artifactUrl,
    idempotencyKey,
  })
  if (!delivered) {
    // 発生元チャットが無い(gtasks 起点等)/未対応チャネル。返信対象なしは失敗ではない。
    console.log('[connectors] notifyChatOnCompletion: 返信対象のチャットなし', { taskRef })
  }
}
