/**
 * タスクを「完了」にできなかったときの理由を、人の言葉にする。
 *
 * 完了の可否を最後に決めるのは DB のトリガー（enforce_review_gate）で、返ってくるのは
 * 英語（`Cannot complete task: review is not approved`）。そのまま出すと読めないし、
 * 何も出さないと「押しても何も起きない」ようにしか見えない（2026-09-18 に本番で実際に起きた:
 * 受信トレイで完了にしても黙って元に戻り、承認が終わっていないことが伝わらなかった）。
 *
 * 完了を断られる画面は受信トレイ・マイタスク・タスク一覧・議事録と複数あるので、
 * 言い換えはここ1か所に置き、どの画面も同じ文を出す。
 */

export type CompleteFailureKind = 'spec_undecided' | 'review_pending' | 'unknown'

/** DB のメッセージから理由を読み取る。前置きが付いていても拾えるよう部分一致で見る。 */
export function classifyCompleteFailure(message: string): CompleteFailureKind {
  if (message.includes('spec decision is not made')) return 'spec_undecided'
  if (message.includes('review is not approved')) return 'review_pending'
  return 'unknown'
}

export function completeFailureMessage(kind: CompleteFailureKind): string {
  if (kind === 'spec_undecided') {
    return 'これは「決定事項のタスク」です。先に「決定にする」を押してから完了にできます'
  }
  if (kind === 'review_pending') {
    return '社内の承認が終わっていないので、まだ完了にできません'
  }
  return 'このタスクを完了にできませんでした'
}

/**
 * 書き込みが 0 行で返ったときの文。RLS で弾かれた更新はエラーではなく 0 行で返るので、
 * 「何も起きなかった」ことを権限・削除の可能性として伝える。
 */
export const COMPLETE_FAILURE_NO_ROWS =
  'このタスクを完了にできませんでした（権限が無いか、削除された可能性があります）'

/** 完了以外のステータス変更が 0 行で返ったときの文 */
export const STATUS_CHANGE_NO_ROWS =
  'ステータスを変更できませんでした（権限が無いか、削除された可能性があります）'

/** ステータス変更（完了以外も含む）が失敗したときの文を、DB のエラーから作る */
export function statusChangeFailureMessage(message: string | null | undefined): string {
  if (!message) return 'ステータスを変更できませんでした'
  const kind = classifyCompleteFailure(message)
  if (kind === 'unknown') return 'ステータスを変更できませんでした'
  return completeFailureMessage(kind)
}
