import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'

import { UUID_REGEX } from '@/lib/uuid'
import { resolveEmailTemplate } from '@/lib/email/templates/orgEmailTemplate'

export const runtime = 'nodejs'

/**
 * GET /api/invites/template?space_id=<uuid>&role=client|member
 *
 * 招待フォームに「いま使われている文面」を出すための読み取り。
 * 文面は 事務所の保存 → 運営の保存 → コード既定 の順で決まる（source でどれかを返す）。
 *
 * 事務所(org)は space_id からサーバー側で引く（画面から渡された org_id は信用しない）。
 * 権限は招待と同じ（事務所のメンバー かつ プロジェクトの admin/editor）。
 * ただし「テンプレートとして保存」は事務所全体に効くので、可否(can_save_template)は
 * 事務所の owner/admin かどうかで別に返す。
 */
interface Resolved {
  orgId: string
  templateKey: 'invite_client' | 'invite_member'
  isOrgAdmin: boolean
}

/** 認証・引数・事務所の解決・招待権限。断るときは NextResponse を返す */
async function resolveRequest(
  request: NextRequest
): Promise<{ error: NextResponse } | { error: null; supabase: SupabaseClient; resolved: Resolved }> {
  const supabase = (await createClient()) as SupabaseClient

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const spaceId = request.nextUrl.searchParams.get('space_id') ?? ''
  const role = request.nextUrl.searchParams.get('role') ?? ''

  if (!UUID_REGEX.test(spaceId)) {
    return { error: NextResponse.json({ error: 'Invalid space id' }, { status: 400 }) }
  }
  if (!['client', 'member'].includes(role)) {
    return { error: NextResponse.json({ error: 'Invalid role' }, { status: 400 }) }
  }

  const { data: space } = await supabase.from('spaces').select('org_id').eq('id', spaceId).single()
  if (!space?.org_id) {
    return { error: NextResponse.json({ error: 'Space not found' }, { status: 404 }) }
  }
  const orgId = space.org_id as string

  const [{ data: orgMembership }, { data: spaceMembership }] = await Promise.all([
    supabase.from('org_memberships').select('role').eq('user_id', user.id).eq('org_id', orgId).single(),
    supabase.from('space_memberships').select('role').eq('user_id', user.id).eq('space_id', spaceId).single(),
  ])

  if (!orgMembership || !['owner', 'member'].includes(orgMembership.role)) {
    return { error: NextResponse.json({ error: 'Permission denied' }, { status: 403 }) }
  }
  if (!spaceMembership || !['admin', 'editor'].includes(spaceMembership.role)) {
    return { error: NextResponse.json({ error: 'Permission denied for this space' }, { status: 403 }) }
  }

  return {
    error: null,
    supabase,
    resolved: {
      orgId,
      templateKey: role === 'client' ? 'invite_client' : 'invite_member',
      isOrgAdmin: ['owner', 'admin'].includes(orgMembership.role),
    },
  }
}

/**
 * GET /api/invites/template?space_id=<uuid>&role=client|member
 *
 * 招待フォームに「いま使われている文面」を出すための読み取り。
 * 文面は 事務所の保存 → 運営の保存 → コード既定 の順で決まる（source でどれかを返す）。
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await resolveRequest(request)
    if (ctx.error) return ctx.error

    const { fields, source } = await resolveEmailTemplate(ctx.resolved.orgId, ctx.resolved.templateKey)

    return NextResponse.json({
      fields,
      source,
      can_save_template: ctx.resolved.isOrgAdmin,
    })
  } catch (err) {
    console.error('Load invite template error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/invites/template?space_id=<uuid>&role=client|member
 *
 * 事務所の保存を消して標準の文面に戻す。保存と同じく事務所の管理者だけ。
 */
export async function DELETE(request: NextRequest) {
  try {
    const ctx = await resolveRequest(request)
    if (ctx.error) return ctx.error
    if (!ctx.resolved.isOrgAdmin) {
      return NextResponse.json(
        { error: '標準の文面に戻せるのは事務所の管理者だけです' },
        { status: 403 }
      )
    }

    const { error } = await ctx.supabase.rpc('rpc_reset_org_email_template', {
      p_org_id: ctx.resolved.orgId,
      p_key: ctx.resolved.templateKey,
    })
    if (error) {
      console.error('Reset invite template error:', error)
      return NextResponse.json({ error: '標準の文面に戻せませんでした' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('Reset invite template error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
