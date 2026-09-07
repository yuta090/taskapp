/**
 * 「二要素認証を登録済みの人は、コード入力済み(aal2)でなければ API を通さない」判定（server 専用）。
 *
 * 画面の門番(src/proxy.ts)は cookie の中身（署名の無い user.factors）を見るだけなので、UX の誘導にしかならない。
 * 本当の強制はここ: 検証済みトークンの aal クレームと、Auth API に問い合わせた factor 一覧（権威ある情報）で判定する。
 * 運営 API（verifySuperadmin）は必ずこれを通す。
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export type Aal2Check =
  | { ok: true; userId: string; enrolled: boolean }
  | { ok: false; reason: 'unauthenticated' | 'mfa_required' | 'mfa_not_enrolled' | 'check_failed'; userId?: string }

/** JWT の payload から aal を読む（署名検証は getUser() が済ませたトークンにだけ使うこと） */
export function readAalClaim(accessToken: string | null | undefined): 'aal1' | 'aal2' | null {
  if (!accessToken) return null
  try {
    const payload = accessToken.split('.')[1]
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    const aal = (JSON.parse(json) as { aal?: unknown }).aal
    return aal === 'aal2' ? 'aal2' : aal === 'aal1' ? 'aal1' : null
  } catch {
    return null
  }
}

/**
 * @param strict true = 登録していない人も拒否（「二要素認証が必須」の面で使う）
 */
export async function checkAal2(supabase: SupabaseClient, opts: { strict?: boolean } = {}): Promise<Aal2Check> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return { ok: false, reason: 'unauthenticated' }

    const [{ data: sessionData }, factors] = await Promise.all([supabase.auth.getSession(), supabase.auth.mfa.listFactors()])
    if (factors.error) {
      console.error('[aal2] listFactors failed:', factors.error.message)
      return { ok: false, reason: 'check_failed', userId: user.id }
    }
    const enrolled = (factors.data?.all ?? []).some((f) => f.status === 'verified')
    const aal = readAalClaim(sessionData.session?.access_token)

    if (enrolled && aal !== 'aal2') return { ok: false, reason: 'mfa_required', userId: user.id }
    if (opts.strict && !enrolled) return { ok: false, reason: 'mfa_not_enrolled', userId: user.id }
    return { ok: true, userId: user.id, enrolled }
  } catch (err) {
    // 例外（Auth API 不通・想定外の応答）も「判定できない」= 締め出す（fail-closed）
    console.error('[aal2] check failed:', err instanceof Error ? err.message : err)
    return { ok: false, reason: 'check_failed' }
  }
}
