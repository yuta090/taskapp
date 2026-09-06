import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifySuperadmin } from '@/lib/admin/verify-superadmin'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * POST /api/admin/milestones/reconcile — 節目の再集計（運営専用）
 *
 * body（任意）: { orgId?: string } … 指定すればその組織だけ、無ければ全組織
 *
 * - 門番: verifySuperadmin（運営でなければ 403）
 * - DB の reconcile_org_milestones() を service role で呼ぶ。冪等（何度呼んでも増えるのは足りない行だけ）。
 *   毎時の cron でも同じ関数が動くので、この API は「今すぐ最新にしたい」ときの手動起動。
 */
export async function POST(request: NextRequest) {
  const adminUserId = await verifySuperadmin()
  if (!adminUserId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = (await request.json().catch(() => null)) as { orgId?: unknown } | null
  let orgId: string | null = null
  if (body && body.orgId != null) {
    if (typeof body.orgId !== 'string' || !UUID_RE.test(body.orgId)) {
      return NextResponse.json({ error: 'invalid organization id' }, { status: 400 })
    }
    orgId = body.orgId
  }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('reconcile_org_milestones', { p_org_id: orgId })
  if (error) {
    console.error('[admin/milestones/reconcile] rpc failed:', error)
    return NextResponse.json({ error: '再集計に失敗しました' }, { status: 500 })
  }

  return NextResponse.json({ added: typeof data === 'number' ? data : Number(data ?? 0), orgId })
}
