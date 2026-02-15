import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'

// UUID v4 format validation
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    // 認証チェック
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // org_id を取得
    const { searchParams } = new URL(request.url)
    let orgId = searchParams.get('org_id')

    // org_id が指定された場合はUUID形式を検証
    if (orgId && !UUID_REGEX.test(orgId)) {
      return NextResponse.json(
        { error: 'Invalid org_id format' },
        { status: 400 }
      )
    }

    // org_id が指定されていない場合はユーザーの所属組織を取得
    if (!orgId) {
      const { data: membership } = await (supabase as SupabaseClient)
        .from('org_memberships')
        .select('org_id')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true })
        .limit(1)
        .single()

      if (!membership) {
        return NextResponse.json(
          { error: 'No organization found' },
          { status: 404 }
        )
      }

      orgId = membership.org_id
    } else {
      // org_id が指定された場合、ユーザーがその組織のメンバーか確認
      const { data: membership } = await (supabase as SupabaseClient)
        .from('org_memberships')
        .select('org_id, role')
        .eq('user_id', user.id)
        .eq('org_id', orgId)
        .single()

      if (!membership) {
        return NextResponse.json(
          { error: 'Access denied' },
          { status: 403 }
        )
      }
    }

    // RPC で制限情報を取得
    const { data, error } = await (supabase as SupabaseClient).rpc('rpc_check_org_limits', {
      p_org_id: orgId,
    })

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      )
    }

    // RPC応答をフラット構造に変換（Hook/UIが期待する形式）
    const flatResponse = {
      plan_name: data?.plan_name || 'Unknown',
      projects_limit: data?.projects?.limit ?? null,
      projects_used: data?.projects?.current ?? 0,
      members_limit: data?.members?.limit ?? null,
      members_used: data?.members?.current ?? 0,
      clients_limit: data?.clients?.limit ?? null,
      clients_used: data?.clients?.current ?? 0,
      storage_limit_bytes: data?.storage?.limit ?? null,
      storage_used_bytes: data?.storage?.current ?? 0,
    }

    return NextResponse.json(flatResponse)
  } catch (err) {
    console.error('Get limits error:', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
