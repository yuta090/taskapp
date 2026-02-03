import { createClient } from '@/lib/supabase/server'
import { sendInviteEmail } from '@/lib/email'
import { NextRequest, NextResponse } from 'next/server'

// UUID v4 format validation
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
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
    const { org_id, space_id, email, role } = body

    // バリデーション
    if (!org_id || !space_id || !email || !role) {
      return NextResponse.json(
        { error: 'Missing required fields' },
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
    const { data: orgMembership } = await (supabase as any)
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
    const { data: spaceMembership } = await (supabase as any)
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

    // 組織名とスペース名を取得
    const [orgResult, spaceResult] = await Promise.all([
      (supabase as any)
        .from('organizations')
        .select('name')
        .eq('id', org_id)
        .single(),
      (supabase as any)
        .from('spaces')
        .select('name')
        .eq('id', space_id)
        .single(),
    ])

    const orgName = orgResult.data?.name || '組織'
    const spaceName = spaceResult.data?.name || 'プロジェクト'

    // RPC で招待作成（制限チェック含む）
    const { data, error } = await (supabase as any).rpc('rpc_create_invite', {
      p_org_id: org_id,
      p_space_id: space_id,
      p_email: normalizedEmail,
      p_role: role,
      p_created_by: user.id,
    })

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      )
    }

    // メール送信（失敗してもAPIは成功として扱う）
    let emailSent = false
    if (data?.token && data?.expires_at) {
      try {
        // 招待者の名前を取得（ユーザーメタデータまたはメールアドレス）
        const inviterName = user.user_metadata?.full_name || user.email || '管理者'

        await sendInviteEmail({
          to: normalizedEmail,
          inviterName,
          orgName,
          spaceName,
          role: role as 'client' | 'member',
          token: data.token,
          expiresAt: data.expires_at,
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
    })
  } catch (err) {
    console.error('Create invite error:', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
