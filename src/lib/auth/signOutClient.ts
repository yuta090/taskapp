'use client'

import { createClient } from '@/lib/supabase/client'
import { cleanupPushOnLogout } from '@/lib/push/cleanupPushOnLogout'
import { DRAFT_PREFIX } from '@/lib/hooks/useFormDraft'

/**
 * サインアウト→別ユーザーでサインインをフルリロード無しで行うと、ルート常駐のクライアント状態
 * (query cache の観測者・ActiveOrgProvider・cached-auth などモジュール変数)が前のユーザーの
 * データを持ったまま残ってしまう。あらゆるログアウト経路をここに集約し、必ずフルページ遷移で
 * 終わらせる(=モジュール状態ごと作り直す)ことで解決する。
 *
 * QueryProvider の onAuthStateChange が SIGNED_OUT を検知しても自前でリロードしないよう、
 * `isSignOutInProgress()` でこの関数の実行中であることを伝える(既にここでリロードするため、
 * 二重リロードを防ぐ)。この旗は時間で自動失効する（下記 SIGN_OUT_IN_PROGRESS_WINDOW_MS）—
 * 何らかの理由でこの関数が実際のページ遷移に辿り着けなかった場合（例: 同一URL#hash への
 * location.replace は遷移が起きない）でも、QueryProvider 側のフォールバック（hardResetIfNeeded）
 * が永久に無効化されたままにならないための安全弁。
 */
let signOutInProgressAt: number | null = null
const SIGN_OUT_IN_PROGRESS_WINDOW_MS = 10_000

export function isSignOutInProgress(): boolean {
  if (signOutInProgressAt === null) return false
  return Date.now() - signOutInProgressAt < SIGN_OUT_IN_PROGRESS_WINDOW_MS
}

/** フォーム下書き(useFormDraft)の localStorage キーだけを消す。他のキー(最終アクセスパス・
 *  折りたたみ状態などUI設定)は次のユーザーにとっても有用なことがあるため残す。 */
function clearFormDrafts(): void {
  try {
    const keysToRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith(DRAFT_PREFIX)) keysToRemove.push(key)
    }
    for (const key of keysToRemove) localStorage.removeItem(key)
  } catch {
    // localStorage が使えない環境（プライベートブラウジング等）でもログアウト自体は続行する
  }
}

/**
 * auth.signOut() が `{ error }` を返す（ネットワーク断・5xx 等。auth-js はこの場合 throw せず、
 * かつ Cookie も消さない）と、共有PCで次の人が開いたときに proxy がまだ有効なセッションを見つけ
 * 「ログアウトしたはずなのにログイン中のまま」になってしまう。signOut() が失敗を報告した／例外に
 * なった場合は、Supabase の auth cookie（`sb-<project-ref>-auth-token` とその分割チャンク
 * `.0` `.1` …）をここで明示的に失効させる。`signOut({ scope: 'local' })` は依然として
 * サーバーへ `/logout` を呼び、失敗時はセッションが残るため代替にならない。
 */
function clearSupabaseAuthCookies(): void {
  try {
    const names = document.cookie
      .split(';')
      .map((pair) => pair.split('=')[0]?.trim())
      .filter((name): name is string => !!name && name.startsWith('sb-') && name.includes('-auth-token'))
    for (const name of names) {
      document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`
    }
  } catch {
    // document.cookie が使えない環境でもログアウト自体は続行する
  }
}

/** `to` が「現在のページと同一URL（#hash 違いのみ）」に解決されるかどうか。
 *  location.replace() はこの場合ブラウザ的には in-page navigation 扱いになり実際にはリロード
 *  されない（hash 変更のみ）。呼び出し側はこのとき location.reload() に倒す必要がある。 */
function resolvesToCurrentPageIgnoringHash(to: string): boolean {
  try {
    const target = new URL(to, window.location.href)
    const current = new URL(window.location.href)
    target.hash = ''
    current.hash = ''
    return target.href === current.href
  } catch {
    return false
  }
}

interface SignOutAndLeaveOptions {
  /** サインアウト後に遷移する先。既定は /login */
  to?: string
  /** Web Push 購読の解除を signOut() の前に行うか。既定は true。
   *  ボタンを押す時点でユーザーがまだログイン中（アカウント切替・通常のログアウト等）なら
   *  必ず true のままにする — false のままだと押した本人の購読が端末に残り、共有端末で
   *  次にログインした別ユーザーが前の人宛の通知を受け取ってしまう。
   *  false にしてよいのは「押す時点で使えるセッションが無い（or 使うべきでない）」画面だけ
   *  （例: MFA コード入力前・オンボーディングでまだ組織に入っていない状態からのやり直し）。 */
  pushCleanup?: boolean
}

/**
 * すべてのログアウト経路の唯一の入口。
 * cleanupPushOnLogout → 下書き削除 → auth.signOut() → 必ずフルページ遷移、の順で行う。
 * 途中の失敗（push解除・signOut）はログアウト自体を止めない — 最終的に離脱できることを優先する。
 */
export async function signOutAndLeave({
  to = '/login',
  pushCleanup = true,
}: SignOutAndLeaveOptions = {}): Promise<void> {
  signOutInProgressAt = Date.now()
  try {
    if (pushCleanup) {
      // /api/push/unsubscribe は有効なセッションを要求するため、signOut() より前に行う
      try {
        await cleanupPushOnLogout()
      } catch {
        // ベストエフォート。失敗してもログアウト自体は続行する
      }
    }

    clearFormDrafts()

    try {
      const { error } = await createClient().auth.signOut()
      if (error) {
        // auth-js はネットワーク断・5xx などで throw せず { error } を返すだけで、
        // この場合 Cookie は削除されない。ここで検知して手動で失効させないと
        // 「ログアウトしたつもりが実はまだログイン中」になる
        clearSupabaseAuthCookies()
      }
    } catch {
      // signOut の呼び出し自体が例外（ネットワーク断等）でも同様にCookieを手動で失効させる
      clearSupabaseAuthCookies()
    }
  } finally {
    if (resolvesToCurrentPageIgnoringHash(to)) {
      window.location.reload()
    } else {
      window.location.replace(to)
    }
  }
}
