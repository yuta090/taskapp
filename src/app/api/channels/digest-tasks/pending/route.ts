import { NextRequest, NextResponse } from 'next/server'
import { requireInternalMember } from '@/lib/channels/authz'
import { listPendingApprovalsForUser } from '@/lib/channels/store'
import { isValidUuid } from '@/lib/uuid'

export const runtime = 'nodejs'

/**
 * GET /api/channels/digest-tasks/pending?orgId=... — 「確認待ち」トレイ（Stage 2.7-B §5）
 *
 * セッションユーザー宛（requested_to_user_id = 本人）の pending 承認候補を返す。
 * LINE 1:1 が届かなかった場合の確実なフォールバック。state ベースで引くため、
 * 送信済み/未送信に関わらず未処理の候補が全て出る。他人の承認待ちは見えない。
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

  const items = await listPendingApprovalsForUser(orgId, auth.userId)
  return NextResponse.json({ items })
}
