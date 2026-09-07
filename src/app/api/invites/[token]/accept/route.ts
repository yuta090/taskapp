import { createClient } from '@/lib/supabase/server'
import { mfaGuardResponse } from '@/lib/auth/apiMfaGuard'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'
import { emailsMatch } from '@/lib/invite/emailMatch'
import { seatLimitFromRpcError } from '@/lib/billing/seatLimitMessage'

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
  created_by: string
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
      .select('id, org_id, space_id, email, role, accepted_at, expires_at, created_by')
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
      // 二要素認証: 登録済み × コード未入力(aal1) は承諾させない（service role で触る前に弾く）
      const mfaBlock = await mfaGuardResponse(supabase as SupabaseClient, user)
      if (mfaBlock) return mfaBlock
      // V5（wrong-account join 防止）: 招待は宛先メールのアカウントにのみ紐付ける。
      // 転送されたリンクや共用ブラウザで、別人のセッションに招待を
      // 消費させない（vendor-portal と同じガードをこちらにも適用）
      if (!emailsMatch(user.email, inviteRow.email)) {
        return NextResponse.json(
          {
            error:
              'この招待は別のメールアドレス宛です。招待メールの宛先アカウントでログインし直してください。',
          },
          { status: 403 }
        )
      }
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
      // 人数枠（plans.members_limit / clients_limit）由来は、招待された本人が読んで
      // 次にできること（管理者に連絡）が分かる日本語＋402に畳む
      const seat = seatLimitFromRpcError(acceptError.message, 'accept')
      if (seat) {
        return NextResponse.json({ error: seat.message, code: seat.code }, { status: seat.status })
      }
      return NextResponse.json({ error: acceptError.message }, { status: 400 })
    }

    // 招待した人への通知はベストエフォート。失敗しても承諾レスポンス自体は成功のまま返す
    await notifyInviter(admin, inviteRow, userId)

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

function inviteRoleLabel(role: string): string {
  if (role === 'client') return '相手先'
  if (role === 'vendor') return 'ベンダー'
  return 'メンバー'
}

/**
 * 招待を承諾したことを、招待を作成した人（＝招待した本人）へ通知する。
 * ベストエフォート — 失敗しても招待承諾自体は成功として扱う（await はしているが、
 * エラーを投げ返さず内部でもみ消すので呼び出し側のレスポンスには影響しない）。
 * 自分自身が作成した招待を自分で承諾した場合は通知しない。
 */
async function notifyInviter(
  admin: SupabaseClient,
  invite: InviteRow,
  acceptedUserId: string,
): Promise<void> {
  if (invite.created_by === acceptedUserId) return

  try {
    const { data: space } = await admin
      .from('spaces')
      .select('name')
      .eq('id', invite.space_id)
      .single()

    const spaceName = (space as { name?: string } | null)?.name || 'プロジェクト'
    const roleLabel = inviteRoleLabel(invite.role)

    // upsert+ignoreDuplicates(素のinsertではない): rpc_accept_invite は行ロックを取らないため
    // 二重承諾リクエストが両方通り得る。素のinsertだと2件目がunique制約違反でログを汚すだけで
    // 実害は無いが、ignoreDuplicatesにすれば衝突行が静かにスキップされる
    // （src/lib/sinks/notify.ts / src/lib/channels/freeCapNudge.ts と同じ型）。
    const { error } = await admin
      .from('notifications')
      .upsert(
        [
          {
            org_id: invite.org_id,
            space_id: invite.space_id,
            to_user_id: invite.created_by,
            channel: 'in_app',
            type: 'invite_accepted',
            dedupe_key: `invite_accepted:${invite.id}:${invite.created_by}`,
            payload: {
              invite_id: invite.id,
              space_id: invite.space_id,
              invitee_email: invite.email,
              role: invite.role,
              title: '招待が承諾されました',
              message: `${invite.email}さん（${roleLabel}）が「${spaceName}」の招待を承諾しました`,
              link: `/${invite.org_id}/project/${invite.space_id}/settings`,
            },
          },
        ],
        { onConflict: 'to_user_id,channel,dedupe_key', ignoreDuplicates: true },
      )

    if (error) {
      console.error('Invite accepted notification upsert error:', error)
    }
  } catch (err) {
    console.error('Invite accepted notification unexpected error:', err)
  }
}
