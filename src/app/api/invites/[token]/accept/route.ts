import { createClient } from '@/lib/supabase/server'
import { mfaGuardResponse } from '@/lib/auth/apiMfaGuard'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'
import { emailsMatch } from '@/lib/invite/emailMatch'
import { seatLimitFromRpcError } from '@/lib/billing/seatLimitMessage'
import { isOrgInternalRole } from '@/lib/roles/spaceRoles'

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

    // 組織の役割と space の役割をそろえる決まり（DB のトリガー）に当てる前に、
    // ここで確かめて分かる日本語で断る。DB の英語の例外をそのまま画面に出さない。
    const { data: existingSpaceMembership } = await admin
      .from('space_memberships')
      .select('id')
      .eq('space_id', inviteRow.space_id)
      .eq('user_id', userId)
      .maybeSingle()

    if (existingSpaceMembership) {
      // すでにこの space のメンバー: 人数枠チェックも RPC も通さず、招待だけ受諾済みにする
      // （on conflict do nothing で無害とはいえ、定員に達した組織で再クリックすると
      // rpc_check_org_limits の枠チェックにだけ引っかかって失敗して見える不具合を避ける）。
      //
      // rpc_accept_invite はこの近道を通らないため、招待中の担当者として置かれていた
      // タスクの引き継ぎ（20260910201400_accept_invite_handover_assignee.sql の
      // 本文と同じ update）もここで行う。排他制約（tasks_single_assignee_chk）に
      // 当たらないよう、assignee_id と assignee_invite_id は同じ update で書く。
      const nowIso = new Date().toISOString()
      const { error: handoverError } = await admin
        .from('tasks')
        .update({ assignee_id: userId, assignee_invite_id: null, updated_at: nowIso })
        .eq('assignee_invite_id', inviteRow.id)

      if (handoverError) {
        console.error('Failed to hand over assignee-invite tasks:', handoverError)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
      }

      // 引き継ぎが済んでから受諾済みにする。ここが失敗したら受諾済みにしない
      // （次に押したときにもう一度やり直せるようにする）
      const { error: acceptMarkError } = await admin
        .from('invites')
        .update({ accepted_at: nowIso })
        .eq('id', inviteRow.id)

      if (acceptMarkError) {
        console.error('Failed to mark invite as accepted:', acceptMarkError)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
      }

      await notifyInviter(admin, inviteRow, userId)

      return NextResponse.json({
        org_id: inviteRow.org_id,
        space_id: inviteRow.space_id,
        role: inviteRow.role,
        email: inviteRow.email,
        created,
      })
    }

    const { data: existingOrgMembership } = await admin
      .from('org_memberships')
      .select('role')
      .eq('org_id', inviteRow.org_id)
      .eq('user_id', userId)
      .maybeSingle()

    if (existingOrgMembership) {
      const mismatch = orgRoleInviteMismatchMessage(
        (existingOrgMembership as { role: string }).role,
        inviteRow.role
      )
      if (mismatch) {
        return NextResponse.json({ error: mismatch }, { status: 409 })
      }
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
      // 念のため: 上の事前確認をすり抜けて、組織と space の役割の不整合を守る DB の
      // トリガー（英語の例外）が返ってきた場合も、生の文言をそのまま出さない
      if (/is not allowed for organization role|does not match space roles/.test(acceptError.message)) {
        return NextResponse.json(
          { error: '組織の役割と招待の種類が合わないため、受諾できませんでした。管理者にご確認ください。' },
          { status: 409 }
        )
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
 * 組織の役割と space の役割をそろえる決まり（20260912112543_org_space_role_consistency.sql）:
 * 組織 client（相手先・協力会社）は space が client/vendor だけ、組織 owner/member（社内）は
 * space が admin/editor/viewer だけ。すでに組織にいる人が種類の合わない招待
 * （社内が相手先・協力会社向け／相手先が社内向け）を受けようとした場合に、分かる日本語で断る。
 * 合っていれば null（呼び出し側はそのまま rpc_accept_invite へ進める）。
 */
function orgRoleInviteMismatchMessage(existingOrgRole: string, inviteRole: string): string | null {
  const orgIsInternal = isOrgInternalRole(existingOrgRole)
  const inviteIsInternal = inviteRole === 'member'
  if (orgIsInternal === inviteIsInternal) return null

  if (orgIsInternal) {
    return `この招待は${inviteRoleLabel(inviteRole)}向けです。すでに社内メンバーとして参加しているため使えません`
  }
  return 'この招待は社内メンバー向けです。すでに相手先として参加しているため使えません'
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
