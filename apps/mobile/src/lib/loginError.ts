/**
 * メールアドレスとパスワードでのログインに失敗したときの文言。
 * 通信エラーなどを「パスワードが違います」と出すと、正しいのに打ち直させてしまうので分ける。
 */
export function loginErrorMessage(error: { code?: string; status?: number; message?: string }): string {
  if (error.code === 'invalid_credentials' || /invalid login credentials/i.test(error.message ?? '')) {
    return 'メールアドレスかパスワードが違います'
  }
  if (error.code === 'email_not_confirmed') {
    return 'メールアドレスの確認が済んでいません。届いたメールのリンクを開いてください'
  }
  if (error.status === 429 || error.code === 'over_request_rate_limit') {
    return 'ログインの試行が多すぎます。しばらく待ってからお試しください'
  }
  return 'ログインできませんでした。通信の状態を確かめて、もう一度お試しください'
}
