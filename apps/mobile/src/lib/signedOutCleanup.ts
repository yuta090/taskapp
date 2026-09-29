/**
 * ログインが自分のログアウト以外で切れたとき（ログインの期限切れ・他の端末からの全端末ログアウト）の後片付け。
 * もう DB に触れないので、Web の /api/mobile/push-token/unregister に端末のトークンを渡して宛先を外してもらう
 * （トークンを持っていることが証明）。外さないと、前の人の通知がこの端末に届き続ける。
 */
export async function cleanupPushAfterSignedOut(deps: {
  manual: boolean
  getStoredToken: () => Promise<string | null>
  postUnregister: (token: string) => Promise<boolean>
  clearStoredToken: () => Promise<void>
}): Promise<void> {
  if (deps.manual) return
  try {
    const token = await deps.getStoredToken()
    if (!token) return
    if (await deps.postUnregister(token)) await deps.clearStoredToken()
  } catch (e) {
    console.warn('[push] Failed to unregister after sign-out:', e)
  }
}
