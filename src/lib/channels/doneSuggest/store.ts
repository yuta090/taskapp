import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * 完了サジェスト台帳（task_done_suggestions・20260724054829）のデータアクセス層（service role専用）。
 *
 * 冪等の要: task_id に通常のunique（1タスク=生涯1行）。insertは
 *   on conflict (task_id) do nothing
 * の「送信勝者のみpush」運用（webhook再配送・複数worker競合でも二重DMを防ぐ）。
 * 却下(dismissed)後も行は残る＝再サジェストを恒久抑止する。
 */

function admin(): SupabaseClient {
  return createAdminClient() as SupabaseClient
}

export interface InsertDoneSuggestionInput {
  taskId: string
  channelGroupId: string | null
  triggerMessageId: string | null
  suggestedToUserId: string | null
}

/**
 * 台帳へinsertする。upsert + ignoreDuplicates + select で
 * 「実際にinsertされた行があるか（＝送信勝者か）」を返す。
 * 呼び出し側は inserted=false のとき push しない（既に台帳がある＝二度目のサジェスト）。
 */
export async function insertDoneSuggestion(
  input: InsertDoneSuggestionInput,
): Promise<{ inserted: boolean }> {
  const { data, error } = await admin()
    .from('task_done_suggestions')
    .upsert(
      {
        task_id: input.taskId,
        channel_group_id: input.channelGroupId,
        trigger_message_id: input.triggerMessageId,
        suggested_to_user_id: input.suggestedToUserId,
      },
      { onConflict: 'task_id', ignoreDuplicates: true },
    )
    .select('id')

  if (error) throw new Error(`task_done_suggestions: insert failed: ${error.message}`)
  return { inserted: (data?.length ?? 0) > 0 }
}

/**
 * [完了した]押下（既存のdue reminder done postback経由・rpc_confirm_task_done_via_line成功後）に
 * ベストエフォートで呼ぶ。台帳行が無い（サジェストを出していない task_id）タスクでも0行で静かに終わる。
 * 現在のstatusは問わない（dismissed後でも実際に完了したなら confirmed に更新する — 台帳は
 * 「実際に完了したか」の事実に追従する。再サジェスト抑止はtask_id uniqueが担うため矛盾しない）。
 */
export async function markDoneSuggestionConfirmed(taskId: string): Promise<void> {
  const { error } = await admin()
    .from('task_done_suggestions')
    .update({ status: 'confirmed', updated_at: new Date().toISOString() })
    .eq('task_id', taskId)
  if (error) throw new Error(`task_done_suggestions: mark confirmed failed: ${error.message}`)
}

/**
 * [まだ]押下。status='sent'の行だけを'dismissed'に更新する（既にconfirmed/dismissed済みの行を
 * 巻き戻さない）。かつ suggested_to_user_id が一致する場合のみ更新する
 * （サジェスト送信先本人以外による更新を防ぐ・authzはwebhookHandler側のexternal_user_id解決と
 * この一致確認の二重防御）。戻り値は実際に更新できたか（false=対象外・沈黙対象）。
 */
export async function markDoneSuggestionDismissed(taskId: string, userId: string): Promise<boolean> {
  const { data, error } = await admin()
    .from('task_done_suggestions')
    .update({ status: 'dismissed', updated_at: new Date().toISOString() })
    .eq('task_id', taskId)
    .eq('suggested_to_user_id', userId)
    .eq('status', 'sent')
    .select('id')

  if (error) throw new Error(`task_done_suggestions: mark dismissed failed: ${error.message}`)
  return (data?.length ?? 0) > 0
}

/**
 * 完了サジェスト送出前の可視性チェック（L-1是正・code review）。
 *
 * 送出条件は「送信者がorg内部メンバー」までで、対象タスクが送信者から見て可視か
 * （space アクセス・client_scope/ball マトリクス）までは見ていなかった。
 * rpc_confirm_task_done_via_line 自体は app_task_visible_to_actor で fail-closed するため
 * 漏洩/誤完了は起きないが、不可視なタスクだとサジェストだけ届いて[完了した]が空振りする。
 *
 * 既存の app_task_visible_to_actor(uuid, uuid)（20260721162336・service_role実行専用）をそのまま
 * 呼ぶ（migrationは追加しない）。DBエラー時はfail-closed（false）で返す — 呼び出し側は
 * false を「沈黙（送出しない）」として扱うだけで安全側に倒れる（例外にして呼び出し元の
 * 他の処理を巻き込まない）。
 */
export async function isTaskVisibleToActor(taskId: string, userId: string): Promise<boolean> {
  const { data, error } = await admin().rpc('app_task_visible_to_actor', {
    p_task_id: taskId,
    p_actor: userId,
  })
  if (error) {
    console.error('task_done_suggestions: visibility check failed, failing closed', taskId, userId, error)
    return false
  }
  return data === true
}
