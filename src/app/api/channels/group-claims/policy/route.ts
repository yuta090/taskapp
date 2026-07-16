import { NextRequest, NextResponse } from 'next/server'
import { requireInternalMember } from '@/lib/channels/authz'
import { isCodeOnlyEntitled } from '@/lib/channels/store'
import { isValidUuid } from '@/lib/uuid'

export const runtime = 'nodejs'

/**
 * GET /api/channels/group-claims/policy?orgId=... — code_only entitlement の読取（Stage 4・PR3b）
 *
 * GroupLinksClient が「本部一括発行（code_only）」セクションを表示するかどうかの判定に使う。
 * 書込（allow_code_only の付与）は当社の運用判断（service role専用）で、このAPIには無い。
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

  const allowCodeOnly = await isCodeOnlyEntitled(orgId)
  return NextResponse.json({ allowCodeOnly })
}
