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
 * 二重リロードを防ぐ)。
 */
let signOutInProgress = false

export function isSignOutInProgress(): boolean {
  return signOutInProgress
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

interface SignOutAndLeaveOptions {
  /** サインアウト後に遷移する先。既定は /login */
  to?: string
  /** Web Push 購読の解除を signOut() の前に行うか。/api/push/unsubscribe はセッションが要るため、
   *  既にセッションが無い画面（MFA 未登録・オンボーディング未加入など）からは false にする */
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
  signOutInProgress = true
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
      await createClient().auth.signOut()
    } catch {
      // signOut の失敗（ネットワーク断等）でもクライアント側の離脱は続行する
    }
  } finally {
    window.location.replace(to)
  }
}
