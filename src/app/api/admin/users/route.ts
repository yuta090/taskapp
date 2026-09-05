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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** RPC の SQLSTATE → HTTP。内容（メッセージ）はクライアントに返さない */
const RPC_ERROR_STATUS: Record<string, { status: number; error: string }> = {
  '42501': { status: 403, error: '管理者権限がありません' },
  AD001: { status: 409, error: '自分自身の管理者権限は外せません' },
  P0002: { status: 404, error: 'user not found' },
}

/**
 * PATCH /api/admin/users - 運営（superadmin）の付与・剥奪
 *
 * profiles.is_superadmin はDBトリガーで「service role だけが変更できる」に固定している
 * （20260906082330_profiles_superadmin_guard.sql）。運営を後から増やす／外す正規の経路はここだけ。
 * - 門番: verifySuperadmin（呼び出し側が運営でなければ 403）
 * - 実体は rpc_admin_set_superadmin（service_role 専用）。advisory lock で直列化し、
 *   actor が運営であることを同一トランザクション内で再確認する（A と B が同時に互いを外して
 *   運営 0 人になる競合を防ぐ）。自分自身の旗は API と RPC の両方で拒否する。
 */
export async function PATCH(request: NextRequest) {
  const adminUserId = await verifySuperadmin()
  if (!adminUserId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'body must be an object' }, { status: 400 })
  }

  const { userId, isSuperadmin } = body as { userId?: unknown; isSuperadmin?: unknown }
  if (typeof userId !== 'string' || !UUID_RE.test(userId)) {
    return NextResponse.json({ error: 'userId must be a UUID' }, { status: 400 })
  }
  if (typeof isSuperadmin !== 'boolean') {
    return NextResponse.json({ error: 'isSuperadmin must be boolean' }, { status: 400 })
  }
  if (userId === adminUserId && !isSuperadmin) {
    return NextResponse.json({ error: '自分自身の管理者権限は外せません' }, { status: 400 })
  }

  try {
    const admin = createAdminClient()
    const { data, error } = await admin.rpc('rpc_admin_set_superadmin', {
      p_actor: adminUserId,
      p_target: userId,
      p_flag: isSuperadmin,
    })

    if (error) {
      const mapped = RPC_ERROR_STATUS[(error as { code?: string }).code ?? '']
      if (mapped) {
        return NextResponse.json({ error: mapped.error }, { status: mapped.status })
      }
      console.error('[admin/users] rpc_admin_set_superadmin error:', error.message)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }

    const row = (Array.isArray(data) ? data[0] : data) as { id: string; is_superadmin: boolean } | undefined
    if (!row) {
      return NextResponse.json({ error: 'user not found' }, { status: 404 })
    }

    console.info(`[admin/users] superadmin ${row.is_superadmin ? 'granted' : 'revoked'}: target=${row.id} by=${adminUserId}`)
    return NextResponse.json({ userId: row.id, isSuperadmin: row.is_superadmin })
  } catch (err: unknown) {
    console.error('[admin/users] superadmin update exception:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
