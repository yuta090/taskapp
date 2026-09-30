/**
 * ログアウトの前に、この端末をプッシュ通知の宛先から外す。
 *
 * supabase-js の delete は失敗しても投げず { error } を返すので、必ず見る。消せなかったときは
 * 端末に覚えたトークンを残す（残さないと、DB に前の人の行が残ったまま手がかりが無くなる）。
 * どの結果でもログアウトは止めない。
 */
export type UnregisterResult = 'removed' | 'failed' | 'none'

export async function unregisterPushToken(deps: {
  getStoredToken: () => Promise<string | null>
  deleteTokenRow: (token: string) => Promise<{ error: unknown }>
  clearStoredToken: () => Promise<void>
}): Promise<UnregisterResult> {
  try {
    const token = await deps.getStoredToken()
    if (!token) return 'none'
    const { error } = await deps.deleteTokenRow(token)
    if (error) {
      console.warn('[push] Failed to remove push token row:', error)
      return 'failed'
    }
    await deps.clearStoredToken()
    return 'removed'
  } catch (e) {
    console.warn('[push] Failed to unregister push token:', e)
    return 'failed'
  }
}
