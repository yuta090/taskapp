import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifySuperadminDetailed } from '@/lib/admin/verify-superadmin'
import { recordAuthEvent } from '@/lib/auth/authEventLog'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * POST /api/admin/users/mfa-reset — 利用者の二要素認証を運営が解除する（復旧用・break glass）
 *
 * 認証アプリを失くした人の唯一の復旧経路。本人確認は運営が行う前提（電話・既知のメール等）。
 * - 門番: superadmin かつ **実行者自身が二要素認証を通っている(aal2)** こと。
 *   （盗んだパスワードだけ＝aal1 で自分の factor を消して MFA を無効化する経路を塞ぐ）
 * - 自分自身は解除できない（別の運営に頼む。運営が1人なら Supabase ダッシュボードから）
 * - 成功・拒否とも auth_event_logs に残す（Vercel のログは消えるため）
 * body: { userId }
 */
export async function POST(request: NextRequest) {
  const verdict = await verifySuperadminDetailed()
  if (!verdict.ok) {
    if (verdict.userId) {
      await recordAuthEvent({ stage: 'mfa_reset_denied', provider: 'mfa', userId: verdict.userId, errorCode: verdict.reason, request })
    }
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!verdict.enrolled) {
    // 未登録の運営（ADMIN_MFA_REQUIRED が off の間だけ到達しうる）にも、この操作だけは登録を要求する
    await recordAuthEvent({ stage: 'mfa_reset_denied', provider: 'mfa', userId: verdict.userId, errorCode: 'actor_not_enrolled', request })
    return NextResponse.json({ error: 'この操作には、あなた自身の二要素認証の登録とコード確認が必要です' }, { status: 403 })
  }
  const adminUserId = verdict.userId

  const body = await request.json().catch(() => null)
  const userId = body && typeof body === 'object' ? (body as { userId?: unknown }).userId : undefined
  if (typeof userId !== 'string' || !UUID_RE.test(userId)) {
    return NextResponse.json({ error: 'userId (uuid) required' }, { status: 400 })
  }
  if (userId === adminUserId) {
    await recordAuthEvent({ stage: 'mfa_reset_denied', provider: 'mfa', userId: adminUserId, errorCode: 'self_reset', request, metadata: { target: userId } })
    return NextResponse.json({ error: '自分自身の二要素認証は解除できません。別の運営に依頼してください' }, { status: 409 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin.auth.admin.mfa.listFactors({ userId })
  if (error) {
    console.error('[mfa-reset] listFactors failed', error)
    return NextResponse.json({ error: '二要素認証の情報を取得できませんでした' }, { status: 500 })
  }
  const factors = data?.factors ?? []
  let removed = 0
  for (const f of factors) {
    const { error: delError } = await admin.auth.admin.mfa.deleteFactor({ id: f.id, userId })
    if (delError) {
      console.error('[mfa-reset] deleteFactor failed', f.id, delError)
      await recordAuthEvent({ stage: 'mfa_reset', provider: 'mfa', userId: adminUserId, errorCode: 'delete_failed', request, metadata: { target: userId, removed } })
      return NextResponse.json({ error: '解除に失敗しました', removed }, { status: 500 })
    }
    removed += 1
  }
  await recordAuthEvent({ stage: 'mfa_reset', provider: 'mfa', userId: adminUserId, request, metadata: { target: userId, removed } })
  return NextResponse.json({ removed })
}
