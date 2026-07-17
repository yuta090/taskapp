import { NextRequest, NextResponse } from 'next/server'
import { requireInternalMember } from '@/lib/channels/authz'
import {
  findGroupClaimOrgId,
  approveGroupClaim,
  rejectGroupClaim,
  GroupClaimActionError,
} from '@/lib/channels/store'
import { isValidUuid } from '@/lib/uuid'

export const runtime = 'nodejs'

/**
 * POST /api/channels/group-claims/approval — 共有botグループ紐付けの承認/却下（Stage 4・PR3a）
 *
 * {orgId, claimId, action: 'approve'|'reject'}
 * 内部メンバーのみ入口を通す。承認者user_idは必ずセッション(auth.getUser)から解決し、
 * クライアント申告は受け取らない（設計正本 §3）。
 * 可否の最終判定は rpc_approve_group_claim / rpc_reject_group_claim が再検証する（route は薄い）。
 *
 * promoteのdigest承認 (/api/channels/digest-tasks/approval) とは別route・別store関数を使う
 * （rpc_promote_digest_task 系には触れない）。
 */
export async function POST(request: NextRequest) {
  let parsed: unknown
  try {
    parsed = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const body = parsed as { orgId?: unknown; claimId?: unknown; action?: unknown }

  const orgId = typeof body.orgId === 'string' ? body.orgId : ''
  const claimId = typeof body.claimId === 'string' ? body.claimId : ''
  const action = typeof body.action === 'string' ? body.action : ''

  if (!isValidUuid(orgId) || !isValidUuid(claimId)) {
    return NextResponse.json({ error: 'orgId and claimId are required' }, { status: 400 })
  }
  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json({ error: 'action must be approve or reject' }, { status: 400 })
  }

  const auth = await requireInternalMember(orgId)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  // 越権・他orgのclaimを早期に弾く（RPCもcode.org境界を束縛するが、明快な404を返すための防御）。
  const claimOrgId = await findGroupClaimOrgId(claimId)
  if (!claimOrgId || claimOrgId !== orgId) {
    return NextResponse.json({ error: 'claim not found' }, { status: 404 })
  }

  try {
    if (action === 'approve') {
      const ok = await approveGroupClaim(claimId, auth.userId)
      if (!ok) {
        // 同一グループへの2claim同時承認の敗者（channel_groups_active_uniqueによるgraceful reject）
        return NextResponse.json({ error: 'conflict' }, { status: 409 })
      }
      return NextResponse.json({ status: 'approved' })
    }

    const ok = await rejectGroupClaim(claimId, auth.userId)
    if (!ok) {
      return NextResponse.json({ error: 'conflict' }, { status: 409 })
    }
    return NextResponse.json({ status: 'rejected' })
  } catch (error) {
    if (error instanceof GroupClaimActionError) {
      const status =
        error.reason === 'not_found'
          ? 404
          : error.reason === 'forbidden'
            ? 403
            : error.reason === 'invalid'
              ? 422
              : 409
      return NextResponse.json({ error: error.reason }, { status })
    }
    console.error('group-claims/approval: unexpected error', error)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}
