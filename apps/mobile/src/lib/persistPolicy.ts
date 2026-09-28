/**
 * 端末に取り置く（AsyncStorage に書く）データの決まり。
 * AsyncStorage は暗号化されないので、トークンなど秘密を含むものは入れない（ログイン情報は SecureStore）。
 */

/** 2段階認証の段階を確かめる問い合わせ。キーにアクセストークンが入る */
export const AAL_QUERY_KEY = 'authAssuranceLevel'

export function shouldPersistQuery(queryKey: readonly unknown[]): boolean {
  return queryKey[0] !== AAL_QUERY_KEY
}
