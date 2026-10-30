import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { mfaGuardResponse } from '@/lib/auth/apiMfaGuard'
import { UUID_REGEX } from '@/lib/uuid'

interface UsageRow {
  space_id: string | null
  bytes: number
  file_count: number
}

/**
 * GET: ディスク使用量。
 *   - `?org_id=` だけ → 組織全体（合計・チャットの添付・プロジェクトごとの内訳）。組織の社内メンバー（owner/member）だけ。
 *   - `?org_id=&space_id=` → そのプロジェクトの分だけ。プロジェクトの社内メンバー（client/vendor 以外）だけ。
 * 集計は DB の org_storage_usage（service role 専用）。所属を確かめてから管理用の鍵で呼ぶ。
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = (await createClient()) as SupabaseClient
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const mfaBlock = await mfaGuardResponse(supabase, user)
    if (mfaBlock) return mfaBlock

    const { searchParams } = new URL(request.url)
    const orgId = searchParams.get('org_id')
    const spaceId = searchParams.get('space_id')
    if (!orgId || !UUID_REGEX.test(orgId) || (spaceId !== null && !UUID_REGEX.test(spaceId))) {
      return NextResponse.json({ error: 'Invalid org_id or space_id' }, { status: 400 })
    }

    if (spaceId) {
      const [{ data: space }, { data: membership }] = await Promise.all([
        supabase.from('spaces').select('org_id').eq('id', spaceId).maybeSingle(),
        supabase
          .from('space_memberships')
          .select('role')
          .eq('space_id', spaceId)
          .eq('user_id', user.id)
          .maybeSingle(),
      ])
      if (
        !space ||
        space.org_id !== orgId ||
        !membership ||
        membership.role === 'client' ||
        membership.role === 'vendor'
      ) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
      }
    } else {
      const { data: membership } = await supabase
        .from('org_memberships')
        .select('role')
        .eq('org_id', orgId)
        .eq('user_id', user.id)
        .maybeSingle()
      if (membership?.role !== 'owner' && membership?.role !== 'member') {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
      }
    }

    const admin = createAdminClient({ channel: 'app', actorUserId: user.id }) as SupabaseClient
    // プロジェクト指定のときはそのプロジェクトだけを集計する。組織全体のときは名前の一覧も同時に取る
    const [{ data, error }, spacesResult] = await Promise.all([
      admin.rpc('org_storage_usage', { p_org_id: orgId, p_space_id: spaceId }),
      spaceId
        ? Promise.resolve({ data: null })
        : admin.from('spaces').select('id, name').eq('org_id', orgId).eq('type', 'project'),
    ])
    if (error) {
      console.error('[storage/usage] org_storage_usage failed:', error.message)
      return NextResponse.json({ error: 'Failed to load storage usage' }, { status: 500 })
    }
    const rows = ((data ?? []) as UsageRow[]).map((r) => ({
      space_id: r.space_id,
      bytes: Number(r.bytes) || 0,
      file_count: Number(r.file_count) || 0,
    }))

    if (spaceId) {
      const row = rows.find((r) => r.space_id === spaceId)
      return NextResponse.json({
        space_id: spaceId,
        bytes: row?.bytes ?? 0,
        file_count: row?.file_count ?? 0,
      })
    }

    const spaces = spacesResult.data
    const bySpace = new Map(rows.filter((r) => r.space_id).map((r) => [r.space_id, r]))
    const spaceRows = ((spaces ?? []) as Array<{ id: string; name: string }>)
      .map((s) => ({
        space_id: s.id,
        name: s.name,
        bytes: bySpace.get(s.id)?.bytes ?? 0,
        file_count: bySpace.get(s.id)?.file_count ?? 0,
      }))
      .sort((a, b) => b.bytes - a.bytes)

    return NextResponse.json({
      total_bytes: rows.reduce((sum, r) => sum + r.bytes, 0),
      chat_attachments_bytes: rows.find((r) => r.space_id === null)?.bytes ?? 0,
      spaces: spaceRows,
    })
  } catch (err) {
    console.error('[storage/usage] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
