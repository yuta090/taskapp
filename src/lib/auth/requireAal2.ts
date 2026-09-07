/**
 * 「二要素認証を登録済みの人は、コード入力済み(aal2)でなければ API を通さない」判定（server 専用）。
 *
 * 画面の門番(src/proxy.ts)は cookie の中身（署名の無い user.factors）を見るだけなので、UX の誘導にしかならない。
 * 本当の強制はここ: 検証済みトークンの aal クレームと、Auth API に問い合わせた factor 一覧（権威ある情報）で判定する。
 * 運営 API（verifySuperadmin）は必ずこれを通す。
 */
import type { SupabaseClient, User } from '@supabase/supabase-js'

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
 * @param user   呼び出し側が **supabase.auth.getUser() で取得した** ユーザー。渡すと Auth API への往復を増やさない。
 *               getUser の応答は listFactors と同じデータ源で、factor が無いときは factors キー自体が省かれる
 *               （= 未登録）。手組みのオブジェクトを渡さないこと
 */
export async function checkAal2(
  supabase: SupabaseClient,
  opts: { strict?: boolean; user?: User | null } = {},
): Promise<Aal2Check> {
  try {
    let factorList: Array<{ status: string }>
    let user: { id: string }
    if (opts.user) {
      user = opts.user
      factorList = Array.isArray(opts.user.factors) ? opts.user.factors : []
    } else {
      const res = await supabase.auth.getUser()
      if (!res.data.user) return { ok: false, reason: 'unauthenticated' }
      user = res.data.user
      const factors = await supabase.auth.mfa.listFactors()
      if (factors.error) {
        console.error('[aal2] listFactors failed:', factors.error.message)
        return { ok: false, reason: 'check_failed', userId: user.id }
      }
      factorList = factors.data?.all ?? []
    }
    const { data: sessionData } = await supabase.auth.getSession()
    const enrolled = factorList.some((f) => f.status === 'verified')
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
