/**
 * TASK6 → agentpm登録 の流入計測(アトリビューション)。
 *
 * 仕組み(GA不要・自前DBで完結):
 * 1. 記事内CTAの内部リンクに ?ref=task6&art=<記事slug> を自動付与
 *    (CtaBlock + /task6/[slug]/page.tsx)
 * 2. /signup がパラメータを検証し、auth.signUp の metadata
 *    (signup_ref / signup_art)として保存 → auth.users.raw_user_meta_data に永続
 * 3. 記事別の登録数はSQLで集計(docs/blog/MEASUREMENT_DESIGN.md 参照)
 *
 * 制約(v1): Google(OAuth)登録は metadata を渡せないため未計測。メール登録のみ。
 */

export const TASK6_REF = 'task6'

// ref はホワイトリスト方式(将来 lp1 等を足すならここに追加)
// shindan = タスク滞留診断(/shindan)の結果画面からの登録
const KNOWN_REFS = new Set([TASK6_REF, 'shindan'])
// art は記事slugの形式(blog_posts.slug / URLに使える文字だけ)
const ART_RE = /^[a-z0-9-]{1,64}$/

/**
 * 内部リンクにのみ ref/art を付与する。外部リンク・不正slugはそのまま返す。
 * 既存のクエリ・ハッシュは保持する。
 */
export function appendAttribution(url: string, articleSlug: string): string {
  if (!url.startsWith('/')) return url
  if (!ART_RE.test(articleSlug)) return url

  const parsed = new URL(url, 'http://internal.invalid')
  parsed.searchParams.set('ref', TASK6_REF)
  parsed.searchParams.set('art', articleSlug)
  return parsed.pathname + parsed.search + parsed.hash
}

export interface SignupAttribution {
  signup_ref: string
  signup_art?: string
}

/**
 * signupページが受け取った ref/art を検証して metadata 形式にする。
 * 未知のref・不正形式は記録しない(ユーザーmetadataの汚染防止)。
 */
export function sanitizeAttribution(
  ref: string | null,
  art: string | null
): SignupAttribution | null {
  if (!ref || !KNOWN_REFS.has(ref)) return null
  const result: SignupAttribution = { signup_ref: ref }
  if (art && ART_RE.test(art)) result.signup_art = art
  return result
}

/** localStorage の first-touch 保存キー */
export const ATTRIBUTION_STORAGE_KEY = 'agentpm_acq'

export interface StoredAttribution {
  ref: string
  art?: string
}

/** localStorageから読んだ値を検証つきでパースする(壊れていたらnull) */
export function parseStoredAttribution(raw: string | null): StoredAttribution | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { ref?: unknown; art?: unknown }
    if (typeof parsed.ref !== 'string' || !KNOWN_REFS.has(parsed.ref)) return null
    const result: StoredAttribution = { ref: parsed.ref }
    if (typeof parsed.art === 'string' && ART_RE.test(parsed.art)) result.art = parsed.art
    return result
  } catch {
    return null
  }
}
