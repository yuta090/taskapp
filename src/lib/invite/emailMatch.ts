/**
 * 招待の自動承認可否を判定する純粋ロジック。
 *
 * V5: ログイン中ユーザーのメールが招待メールと一致しない場合、招待を
 * そのセッションのアカウントに自動承認してはならない（wrong-account join 防止）。
 * 大文字小文字・前後空白は無視して比較する。
 */

/** 2つのメールアドレスが（正規化して）一致するか。 */
export function emailsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/**
 * ログイン中セッションのメールで招待を自動承認してよいか。
 * セッションが無い / メール不明 / 招待メールと不一致 の場合は false。
 */
export function shouldAutoAcceptInvite(
  sessionEmail: string | null | undefined,
  inviteEmail: string | null | undefined
): boolean {
  return emailsMatch(sessionEmail, inviteEmail)
}
