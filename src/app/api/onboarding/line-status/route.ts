import { NextRequest, NextResponse } from 'next/server'
import { requireInternalMember } from '@/lib/channels/authz'
import { hasActiveUserLinkForUser, getLineSelfServeState } from '@/lib/channels/store'
import { getAiConfigStatus } from '@/lib/ai/client'
import { isValidUuid } from '@/lib/uuid'

export const runtime = 'nodejs'

/**
 * GET /api/onboarding/line-status?orgId=... — オンボーディング用のLINE連携状態。
 *
 * channel_accounts（資格情報）と channel_user_links は RLS で service_role 専用にしてあり、
 * クライアントからは読めない。ここで service role で判定し **boolean 2つだけ** を返す。
 * credentials / access token / basic_id 等は一切返さない（漏えい面を作らない）。
 *
 * - lineAccountReady: org がLINE秘書を自分で連携し始められる状態か（own|granted＝後方互換）
 * - lineAccess:       共通LINEの org 単位状態 own|granted|requested|none|unavailable（申込制の出し分け用）
 * - hasLineLinked:    リクエストしたユーザー自身の active な user-link があるか
 * - aiConfigured:     org_ai_config に有効なAI設定があるか（＝夜間の自動タスク抽出が動く前提）。
 *                     org_ai_config は owner限定RLSのため内部メンバーは直読みできず、ここで
 *                     service role で有無/有効のみ判定する（APIキーは復号も返却もしない）。
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
    const [lineAccess, hasLineLinked, aiStatus] = await Promise.all([
      getLineSelfServeState(orgId),
      hasActiveUserLinkForUser(orgId, auth.userId),
      getAiConfigStatus(orgId),
    ])
    return NextResponse.json({
      lineAccountReady: lineAccess === 'own' || lineAccess === 'granted',
      lineAccess,
      hasLineLinked,
      aiConfigured: aiStatus.configured,
    })
  } catch (error) {
    console.error('line-status: failed', error)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}
