import { NextRequest, NextResponse } from 'next/server'
import { requireInternalMember } from '@/lib/channels/authz'
import { listPendingGroupClaimsForOrg } from '@/lib/channels/store'
import { getChannel } from '@/lib/channels/registry'
import { isValidUuid } from '@/lib/uuid'

export const runtime = 'nodejs'

/**
 * GET /api/channels/group-claims/pending?orgId=... — 共有botグループ紐付けの確認待ち一覧（Stage 4・PR3a）
 *
 * 自orgの pending claim（LINEグループにコードが投入され承認待ちのもの）を一覧する。
 * `channel` を付けると、その口に届いた claim だけを返す（各チャネルの「つなぐ」画面用）。
 * promoteのdigest承認 (/api/channels/digest-tasks/pending) とは別store関数・別route。
 */
export async function GET(request: NextRequest) {
  const orgId = request.nextUrl.searchParams.get('orgId') ?? ''
  if (!isValidUuid(orgId)) {
    return NextResponse.json({ error: 'orgId is required' }, { status: 400 })
  }

  const auth = await requireInternalMember(orgId)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const channel = request.nextUrl.searchParams.get('channel')
  if (channel !== null && !getChannel(channel)) {
    return NextResponse.json({ error: 'unknown channel' }, { status: 400 })
  }

  const items = channel
    ? await listPendingGroupClaimsForOrg(orgId, channel)
    : await listPendingGroupClaimsForOrg(orgId)
  return NextResponse.json({ items })
}
