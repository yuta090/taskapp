import { NextRequest, NextResponse } from 'next/server'
import { verifySuperadmin } from '@/lib/admin/verify-superadmin'
import { listSharedBotAccessRequests, grantSharedBotAccess } from '@/lib/channels/store'

/**
 * GET  /api/admin/shared-bot-access — 開通待ち(requested)org 一覧（superadmin専用）。
 * POST /api/admin/shared-bot-access — org を共通LINE開通(granted)にする（superadmin専用）。
 *
 * requested→granted の last mile。これまで service role SQL 手動だったのを ops のUI操作に置き換える。
 * 付与者は必ずセッションの superadmin user id（クライアント申告は受けない）。
 */

export async function GET() {
  const adminUserId = await verifySuperadmin()
  if (!adminUserId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const requests = await listSharedBotAccessRequests()
  return NextResponse.json({ requests })
}

export async function POST(request: NextRequest) {
  const adminUserId = await verifySuperadmin()
  if (!adminUserId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { orgId?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const orgId = body.orgId
  if (!orgId || typeof orgId !== 'string') {
    return NextResponse.json({ error: 'orgId required' }, { status: 400 })
  }

  const state = await grantSharedBotAccess(orgId, adminUserId)
  return NextResponse.json({ orgId, sharedBotAccess: state })
}
