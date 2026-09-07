import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifySuperadmin } from '@/lib/admin/verify-superadmin'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * POST /api/admin/users/mfa-reset — 利用者の二要素認証を運営が解除する（復旧用）
 *
 * 認証アプリを失くした人の唯一の復旧経路。本人確認は運営が行う前提（電話・既知のメール等）。
 * 門番: verifySuperadmin。service role で対象ユーザーの factor を全部削除する。
 * body: { userId }
 */
export async function POST(request: NextRequest) {
  const adminUserId = await verifySuperadmin()
  if (!adminUserId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => null)
  const userId = body && typeof body === 'object' ? (body as { userId?: unknown }).userId : undefined
  if (typeof userId !== 'string' || !UUID_RE.test(userId)) {
    return NextResponse.json({ error: 'userId (uuid) required' }, { status: 400 })
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
      return NextResponse.json({ error: '解除に失敗しました', removed }, { status: 500 })
    }
    removed += 1
  }
  console.info('[mfa-reset] by', adminUserId, 'for', userId, 'removed', removed)
  return NextResponse.json({ removed })
}
