/**
 * DBトリガー enforce_review_gate の生の Postgres 例外を、分かりやすい日本語の
 * 409メッセージに変換する。社内レビューが open/blocked のまま、または spec の
 * 決定事項が未決のまま status を 'done' にしようとした UPDATE を拒否したときの
 * メッセージを判定する。該当しなければ null を返し、呼び出し側は汎用メッセージに
 * フォールバックする。
 */
export function reviewGateErrorMessage(updateError: { message: string } | null): string | null {
  const message = updateError?.message ?? ''
  if (message.includes('review is not approved')) {
    return '社内レビューが完了していないため承認できません'
  }
  if (message.includes('spec decision is not made')) {
    return '決定事項が未決のため承認できません'
  }
  return null
}
