import { createAdminClient } from '@/lib/supabase/admin'
import { verifySuperadmin } from '@/lib/admin/verify-superadmin'
import { NextRequest, NextResponse } from 'next/server'

// POST /api/admin/users - Create a new user
export async function POST(request: NextRequest) {
  const adminUserId = await verifySuperadmin()
  if (!adminUserId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const { email, password, displayName } = await request.json()

    if (!email || !password) {
      return NextResponse.json({ error: 'email and password required' }, { status: 400 })
    }

    const admin = createAdminClient()
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    // プロフィール更新
    if (data.user && displayName) {
      await admin
        .from('profiles')
        .update({ display_name: displayName })
        .eq('id', data.user.id)
    }

    return NextResponse.json({ user: data.user })
  } catch (err: unknown) {
    console.error('Admin user creation error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PATCH /api/admin/users - 運営（superadmin）の付与・剥奪
 *
 * profiles.is_superadmin はDBトリガーで「service role だけが変更できる」に固定している
 * （20260906082330_profiles_superadmin_guard.sql）。運営を後から増やす／外す正規の経路はここだけ。
 * - 門番: verifySuperadmin（呼び出し側が運営でなければ 403）
 * - 自分自身の旗は外せない（運営が 0 人になって誰も入れなくなる事故を防ぐ）
 */
export async function PATCH(request: NextRequest) {
  const adminUserId = await verifySuperadmin()
  if (!adminUserId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { userId?: unknown; isSuperadmin?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const { userId, isSuperadmin } = body
  if (typeof userId !== 'string' || !userId) {
    return NextResponse.json({ error: 'userId required' }, { status: 400 })
  }
  if (typeof isSuperadmin !== 'boolean') {
    return NextResponse.json({ error: 'isSuperadmin must be boolean' }, { status: 400 })
  }
  if (userId === adminUserId && !isSuperadmin) {
    return NextResponse.json({ error: '自分自身の管理者権限は外せません' }, { status: 400 })
  }

  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('profiles')
      .update({ is_superadmin: isSuperadmin })
      .eq('id', userId)
      .select('id, is_superadmin')
      .maybeSingle()

    if (error) {
      console.error('[admin/users] superadmin update error:', error.message)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
    if (!data) {
      return NextResponse.json({ error: 'user not found' }, { status: 404 })
    }

    console.info(`[admin/users] superadmin ${isSuperadmin ? 'granted' : 'revoked'}: target=${userId} by=${adminUserId}`)
    return NextResponse.json({ userId, isSuperadmin })
  } catch (err: unknown) {
    console.error('[admin/users] superadmin update exception:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
