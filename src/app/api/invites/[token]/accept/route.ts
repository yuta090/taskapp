import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'

const MIN_PASSWORD_LENGTH = 8

/** Rate limit: 10 accept attempts per IP per 15 minutes (same as invite validation) */
const ACCEPT_RATE_LIMIT = {
  maxRequests: 10,
  windowMs: 15 * 60 * 1000,
} as const

const INVALID_INVITE_ERROR = { error: '招待リンクが無効または期限切れです' }

interface InviteRow {
  id: string
  org_id: string
  space_id: string
  email: string
  role: string
  accepted_at: string | null
  expires_at: string
}

/**
 * POST /api/invites/[token]/accept
 *
 * Server-side invite acceptance. This is the only remaining path to
 * rpc_accept_invite — the RPC is now service_role-only (see
 * supabase/migrations/*_rpc_accept_invite_service_role_only.sql), so a
 * caller can never supply an arbitrary p_user_id directly.
 *
 * Body: { password?: string } — email is never accepted from the client;
 * it always comes from the invite record itself.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params
    if (!token) {
      return NextResponse.json(INVALID_INVITE_ERROR, { status: 404 })
    }

    const clientIp = getClientIp(request)
    const rateResult = checkRateLimit(`invite-accept:${clientIp}`, ACCEPT_RATE_LIMIT)
    if (!rateResult.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        {
          status: 429,
          headers: {
            'Retry-After': String(Math.ceil((rateResult.resetAt - Date.now()) / 1000)),
          },
        }
      )
    }

    let body: { password?: string } = {}
    try {
      body = await request.json()
    } catch {
      // 認証済みセッションでの自動受諾パスはボディ無しで呼ばれる
    }

    const admin = createAdminClient() as SupabaseClient

    const { data: invite, error: inviteError } = await admin
      .from('invites')
      .select('id, org_id, space_id, email, role, accepted_at, expires_at')
      .eq('token', token)
      .single()

    const inviteRow = invite as InviteRow | null

    if (
      inviteError ||
      !inviteRow ||
      inviteRow.accepted_at !== null ||
      new Date(inviteRow.expires_at) < new Date()
    ) {
      return NextResponse.json(INVALID_INVITE_ERROR, { status: 404 })
    }

    // 呼出ユーザーの特定
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    let userId: string
    let created = false

    if (user) {
      userId = user.id
    } else {
      const password = body.password
      if (!password || password.length < MIN_PASSWORD_LENGTH) {
        return NextResponse.json(
          { error: 'パスワードは8文字以上で入力してください' },
          { status: 400 }
        )
      }

      const { data: createdUser, error: createError } = await admin.auth.admin.createUser({
        email: inviteRow.email,
        password,
        email_confirm: true,
      })

      if (createError || !createdUser.user) {
        // 既存アカウント起因のみ 409。それ以外（パスワードポリシー・一時障害等）を
        // 「既にアカウントがあります」と誤案内しない
        const isExistingAccount =
          (createError as { code?: string } | null)?.code === 'email_exists' ||
          /already|registered|exists/i.test(createError?.message ?? '')
        if (isExistingAccount) {
          return NextResponse.json(
            { error: '既にアカウントがあります。ログインしてから招待リンクを開いてください' },
            { status: 409 }
          )
        }
        console.error('Create user error:', createError)
        return NextResponse.json(
          { error: 'アカウントの作成に失敗しました。しばらくしてからお試しください。' },
          { status: 500 }
        )
      }

      userId = createdUser.user.id
      created = true
    }

    const { data: acceptResult, error: acceptError } = await admin.rpc('rpc_accept_invite', {
      p_token: token,
      p_user_id: userId,
    })

    if (acceptError) {
      return NextResponse.json({ error: acceptError.message }, { status: 400 })
    }

    return NextResponse.json({
      org_id: acceptResult.org_id,
      space_id: acceptResult.space_id,
      role: acceptResult.role,
      email: inviteRow.email,
      created,
    })
  } catch (err) {
    console.error('Accept invite error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
