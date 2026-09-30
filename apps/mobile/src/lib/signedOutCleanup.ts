/**
 * ログアウトした・ログインが切れた後に、通知の宛先が残っていたら外す。
 * もう DB に触れないので、Web の /api/mobile/push-token/unregister に端末のトークンを渡して外してもらう
 * （トークンを持っていることが証明）。外さないと、前の人の通知がこの端末に届き続ける。
 *
 * 呼ぶのは SIGNED_OUT のときと、ログインしていない状態でアプリを起動したとき（圏外で外せなかった分のやり直し）。
 * 自分でログアウトしたときは先に自分で外していて、外せていれば覚えたトークンは消えている＝ここでは何もしない。
 */
export async function cleanupPushAfterSignedOut(deps: {
  getStoredToken: () => Promise<string | null>
  postUnregister: (token: string) => Promise<boolean>
  clearStoredToken: () => Promise<void>
}): Promise<void> {
  try {
    const token = await deps.getStoredToken()
    if (!token) return
    if (await deps.postUnregister(token)) await deps.clearStoredToken()
  } catch (e) {
    console.warn('[push] Failed to unregister after sign-out:', e)
  }
}
