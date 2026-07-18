import { NextRequest, NextResponse } from 'next/server'
import { requireInternalMember } from '@/lib/channels/authz'
import { hasActiveUserLinkForUser, isLineSelfServeReady } from '@/lib/channels/store'
import { isValidUuid } from '@/lib/uuid'

export const runtime = 'nodejs'

/**
 * GET /api/onboarding/line-status?orgId=... — オンボーディング用のLINE連携状態。
 *
 * channel_accounts（資格情報）と channel_user_links は RLS で service_role 専用にしてあり、
 * クライアントからは読めない。ここで service role で判定し **boolean 2つだけ** を返す。
 * credentials / access token / basic_id 等は一切返さない（漏えい面を作らない）。
 *
 * - lineAccountReady: org がLINE秘書を自分で連携し始められる状態か（Botが用意済みか）
 * - hasLineLinked:    リクエストしたユーザー自身の active な user-link があるか
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

  try {
    const [lineAccountReady, hasLineLinked] = await Promise.all([
      isLineSelfServeReady(orgId),
      hasActiveUserLinkForUser(orgId, auth.userId),
    ])
    return NextResponse.json({ lineAccountReady, hasLineLinked })
  } catch (error) {
    console.error('line-status: failed', error)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}
