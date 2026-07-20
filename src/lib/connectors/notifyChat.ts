/**
 * multica の完了(task.completed)をチャットへ返信する(契約 §4.1 (b) / §3-2)。
 *
 * TODO(secretary-channels 統合): 送信アダプタ層(`src/lib/channels/adapters`)がこの
 * ブランチ分岐時点でまだ develop にマージされていないため、ここでは「呼ばれた」ことを
 * ログするだけの明示スタブにする。未マージブランチの成果物へ依存させないため、この関数は
 * 意図的に外部呼び出しを一切しない。
 *
 * マージ後の実装(この関数の中身を差し替えるだけで済むよう seam を固定してある):
 *   1. taskRef(= tasks.id)から発生元チャットの結び付き(channel_id / 送信先 to / 資格情報)を解決する。
 *      この結び付きは secretary-channels 側のスキーマ(group claims / channel accounts)にあり、
 *      それが develop に入るまでは解決自体ができないため本関数はスタブに留まる。
 *   2. `deliverToChannel(channel, { credentials, to, text, idempotencyKey })` を呼ぶ
 *      (`import { deliverToChannel } from '@/lib/channels/adapters'`)。
 *      - text     : result.summary(無ければ既定の完了文) + result.artifactUrl
 *      - idempotencyKey: 受信イベントの event_id を渡す(アダプタ側で二重送信を弾くため)
 *   3. 呼び出し側(inbound の propagateTaskCompleted)は本関数を**真の0→1遷移のときだけ**呼び、
 *      失敗は握ってログのみ=ベストエフォート(DB上の完了確定は巻き戻さない)。冪等キー(event_id)を
 *      アダプタに渡せるようになれば、遷移ゲートを外して再送で再駆動させる設計にも移行できる。
 */

export interface MulticaCompletionResult {
  summary: string | null
  artifactUrl: string | null
}

export async function notifyChatOnCompletion(
  taskRef: string,
  result: MulticaCompletionResult,
): Promise<void> {
  console.log(
    '[connectors] notifyChatOnCompletion: スタブ(未実装・secretary-channels統合待ち)',
    { taskRef, result },
  )
}
