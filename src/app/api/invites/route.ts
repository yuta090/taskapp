import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendInviteEmail } from '@/lib/email'
import { resolveSenderOrgName } from '@/lib/email/senderOrgName'
import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'

import { UUID_REGEX } from '@/lib/uuid'
import { seatLimitFromRpcError } from '@/lib/billing/seatLimitMessage'
import { INVITE_PLACEHOLDERS } from '@/lib/email/templates/invite'
import { isTemplateEdited, validateTemplateOverride } from '@/lib/email/templates/inviteOverride'
import { resolveEmailTemplate } from '@/lib/email/templates/orgEmailTemplate'
import type { TemplateFields } from '@/lib/email/templates/core'
// Email format validation
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    // 認証チェック
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { org_id, space_id, email, role, name, message, template, save_as_template } = body

    // バリデーション
    if (!org_id || !space_id || !email || !role) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // 相手の名前は任意入力・最大100文字（一覧表示とメールの宛名に使う）
    const trimmedName = typeof name === 'string' ? name.trim().slice(0, 100) : ''

    // メッセージは任意入力・最大500文字
    const trimmedMessage = typeof message === 'string' ? message.trim() : ''
    if (trimmedMessage.length > 500) {
      return NextResponse.json(
        { error: 'Message exceeds maximum length of 500 characters' },
        { status: 400 }
      )
    }

    // UUID形式検証
    if (!UUID_REGEX.test(org_id) || !UUID_REGEX.test(space_id)) {
      return NextResponse.json(
        { error: 'Invalid UUID format' },
        { status: 400 }
      )
    }

    // メールアドレス正規化と検証
    const normalizedEmail = email.trim().toLowerCase()
    if (!EMAIL_REGEX.test(normalizedEmail)) {
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 }
      )
    }

    if (!['client', 'member'].includes(role)) {
      return NextResponse.json(
        { error: 'Invalid role' },
        { status: 400 }
      )
    }

    // ユーザーが組織の owner または admin であることを確認
    const { data: orgMembership } = await (supabase as SupabaseClient)
      .from('org_memberships')
      .select('role')
      .eq('user_id', user.id)
      .eq('org_id', org_id)
      .single()

    if (!orgMembership || !['owner', 'member'].includes(orgMembership.role)) {
      return NextResponse.json(
        { error: 'Permission denied' },
        { status: 403 }
      )
    }

    // スペースへのアクセス権限を確認
    const { data: spaceMembership } = await (supabase as SupabaseClient)
      .from('space_memberships')
      .select('role')
      .eq('user_id', user.id)
      .eq('space_id', space_id)
      .single()

    if (!spaceMembership || !['admin', 'editor'].includes(spaceMembership.role)) {
      return NextResponse.json(
        { error: 'Permission denied for this space' },
        { status: 403 }
      )
    }

    // 文面のその場編集。既定はこの1通かぎりで、save_as_template のときだけ事務所の文面として残す。
    // 保存は事務所全体（全プロジェクト）に効くので、プロジェクトの管理者ではなく事務所の管理者に限る。
    // 招待を作る前に断ることで「招待は出たが保存はされていない」を避ける。
    const wantsSave = save_as_template === true
    if (wantsSave && !['owner', 'admin'].includes(orgMembership.role)) {
      return NextResponse.json(
        { error: 'テンプレートとして保存できるのは事務所の管理者だけです' },
        { status: 403 }
      )
    }

    const templateKey = role === 'client' ? 'invite_client' : 'invite_member'
    let overrideFields: TemplateFields | undefined
    if (template !== undefined && template !== null) {
      const current = await resolveEmailTemplate(org_id, templateKey)
      const validation = validateTemplateOverride(
        current.fields,
        template,
        INVITE_PLACEHOLDERS.map((p) => p.name)
      )
      if (!validation.ok) {
        return NextResponse.json({ error: validation.error }, { status: 400 })
      }
      // 触っていないなら渡さない（送信側のいつもの決まり方に任せる）
      if (wantsSave || isTemplateEdited(current.fields, validation.fields)) {
        overrideFields = validation.fields
      }
    }

    // 組織名・スペース名・招待者の表示名を取得
    const [orgResult, spaceResult, profileResult] = await Promise.all([
      (supabase as SupabaseClient)
        .from('organizations')
        .select('name')
        .eq('id', org_id)
        .single(),
      (supabase as SupabaseClient)
        .from('spaces')
        .select('name')
        .eq('id', space_id)
        .single(),
      (supabase as SupabaseClient)
        .from('profiles')
        .select('display_name')
        .eq('id', user.id)
        .single(),
    ])

    const orgName = orgResult.data?.name || '組織'
    const spaceName = spaceResult.data?.name || 'プロジェクト'
    const inviterName =
      profileResult.data?.display_name || user.user_metadata?.full_name || user.email || '管理者'

    // RPC で招待作成（制限チェック含む）
    const { data, error } = await (supabase as SupabaseClient).rpc('rpc_create_invite', {
      p_org_id: org_id,
      p_space_id: space_id,
      p_email: normalizedEmail,
      p_role: role,
      p_created_by: user.id,
    })

    if (error) {
      // rpc_create_invite が既存メンバーへの招待を拒否した場合（重複防止）
      if (error.message === 'already a member') {
        return NextResponse.json(
          { error: '既にメンバーです' },
          { status: 409 }
        )
      }
      // 人数枠（plans.members_limit / clients_limit）由来は日本語の案内＋402に畳む
      const seat = seatLimitFromRpcError(error.message, 'create')
      if (seat) {
        return NextResponse.json(
          { error: seat.message, code: seat.code },
          { status: seat.status }
        )
      }
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      )
    }

    // 名前は招待を作ったあとに書く（rpc_create_invite の引数を増やさずに済ませる）。
    // 失敗しても招待自体は成立しているので止めない
    if (trimmedName && data?.invite_id) {
      const { error: nameError } = await (createAdminClient() as SupabaseClient)
        .from('invites')
        .update({ invitee_name: trimmedName })
        .eq('id', data.invite_id)
      if (nameError) console.error('Failed to save invitee name:', nameError)
    }

    // テンプレートとして保存（失敗しても招待とメールは止めず、保存できなかったことだけ返す）
    let templateSaved: boolean | undefined
    if (wantsSave) {
      const fieldsToSave = overrideFields ?? (await resolveEmailTemplate(org_id, templateKey)).fields
      const { error: saveError } = await (supabase as SupabaseClient).rpc('rpc_set_org_email_template', {
        p_org_id: org_id,
        p_key: templateKey,
        p_subject: fieldsToSave.subject,
        p_heading: fieldsToSave.heading,
        p_body: fieldsToSave.body,
        p_cta_label: fieldsToSave.cta_label,
        p_note: fieldsToSave.note,
      })
      if (saveError) {
        console.error('Failed to save org email template:', saveError)
      }
      templateSaved = !saveError
    }

    // メール送信（失敗してもAPIは成功として扱う）
    let emailSent = false
    if (data?.token && data?.expires_at) {
      try {
        await sendInviteEmail({
          to: normalizedEmail,
          inviterName,
          orgName,
          spaceName,
          role: role as 'client' | 'member',
          token: data.token,
          expiresAt: data.expires_at,
          message: trimmedMessage || undefined,
          toName: trimmedName || undefined,
          // 事務所が保存した文面を使う。その場で直したときは fields が優先される
          orgId: org_id,
          fields: overrideFields,
          // 相手が返信したら招待した本人に届くように
          replyTo: user.email,
          // 有料プランの事務所だけ「{事務所名} (AgentPM)」で名乗る
          senderOrgName: await resolveSenderOrgName(supabase as SupabaseClient, org_id),
        })
        emailSent = true
      } catch (emailError) {
        console.error('Failed to send invite email:', emailError)
        // メール送信失敗はログに記録するが、招待自体は成功
      }
    }

    return NextResponse.json({
      ...data,
      email_sent: emailSent,
      ...(templateSaved === undefined ? {} : { template_saved: templateSaved }),
    })
  } catch (err) {
    console.error('Create invite error:', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
