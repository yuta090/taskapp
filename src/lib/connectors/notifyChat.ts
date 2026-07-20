/**
 * multica の完了(task.completed)をチャットへ返信する(契約 §4.1 (b) / §3-2)。
 *
 * TODO: 送信アダプタ層(secretary-channels ストリームの成果物)がこのブランチ分岐時点で
 * まだ develop にマージされていないため、ここでは「呼ばれた」ことをログするだけの
 * 明示スタブにする。secretary-channels マージ後、該当タスクの space/相手先へ
 * 実際のチャット返信(送信アダプタ経由)を行う実装に置き換えること。
 * 未マージブランチの成果物へ依存させないため、この関数は意図的に外部呼び出しを一切しない。
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
