import { NextRequest, NextResponse } from 'next/server'
import { requireInternalMember } from '@/lib/channels/authz'
import {
  verifyGroupInOrg,
  updateChannelGroup,
  unlinkGroup,
  isOrgInternalMember,
  isSpaceApproverEligible,
  setGroupApprover,
  listOrgGroupsWithApprover,
  type PickupMode,
} from '@/lib/channels/store'
import { isValidUuid } from '@/lib/uuid'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveOrgEntitlements } from '@/lib/billing/entitlements'

const ADMIN_ROLES = new Set(['owner', 'admin'])

export const runtime = 'nodejs'

const PICKUP_MODES: readonly PickupMode[] = ['all', 'mention_only', 'off', 'all_plus_instant']

function isPickupMode(value: unknown): value is PickupMode {
  return typeof value === 'string' && (PICKUP_MODES as readonly string[]).includes(value)
}

/**
 * GET /api/channels/groups?orgId=... — 承認フロー設定用のグループ一覧（Stage 2.7-B §5）
 * 内部メンバーのみ。active かつ space 紐付け済みグループと現承認者を返す。
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
  const groups = await listOrgGroupsWithApprover(orgId)
  return NextResponse.json({ groups })
}

/**
 * PATCH /api/channels/groups — グループ管理（秘書コンソール用）
 *
 * {orgId, groupId, pickupMode?, displayName?, approverUserId?, unlink?}
 * 内部メンバーのみ。groupIdのorg一致をサーバ側で検証する。
 * pickupMode: 'all'|'mention_only'|'off'（Stage 2.5 §1）。digestEnabledは廃止。
 * approverUserId（Stage 2.7-B）: 承認フローの責任者。null=解除（オプトアウト）。
 *   *承認者の変更は org owner/admin のみ*（誰が承認するかはガバナンス操作）。設定時は対象が
 *   当該 space の admin/editor であることを検証する（そうでないと承認時に永遠に権限を満たせず
 *   候補が宙吊りになる）。変更は rpc_set_group_approver で原子的に行い旧pendingを none へ戻す。
 * unlink: 誤紐付けの是正（status='left'化）。openな申し送りタスクのauto-dismissは
 * store層（unlinkGroup）で同一処理として行う。
 */
export async function PATCH(request: NextRequest) {
  let parsed: unknown
  try {
    parsed = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const body = parsed as {
    orgId?: unknown
    groupId?: unknown
    pickupMode?: unknown
    displayName?: unknown
    approverUserId?: unknown
    unlink?: unknown
  }

  const orgId = typeof body.orgId === 'string' ? body.orgId : ''
  const groupId = typeof body.groupId === 'string' ? body.groupId : ''
  if (!isValidUuid(orgId) || !isValidUuid(groupId)) {
    return NextResponse.json({ error: 'orgId and groupId are required' }, { status: 400 })
  }

  const unlink = body.unlink === true
  const displayName = typeof body.displayName === 'string' ? body.displayName : undefined

  if (body.pickupMode !== undefined && !isPickupMode(body.pickupMode)) {
    return NextResponse.json({ error: 'invalid pickupMode' }, { status: 400 })
  }
  const pickupMode = isPickupMode(body.pickupMode) ? body.pickupMode : undefined

  // approverUserId: キー未指定=変更なし / null=解除 / 有効UUID=設定。それ以外の型は 400。
  const approverProvided = 'approverUserId' in body && body.approverUserId !== undefined
  let approverUserId: string | null | undefined = undefined
  if (approverProvided) {
    if (body.approverUserId === null) {
      approverUserId = null
    } else if (typeof body.approverUserId === 'string' && isValidUuid(body.approverUserId)) {
      approverUserId = body.approverUserId
    } else {
      return NextResponse.json({ error: 'invalid approverUserId' }, { status: 400 })
    }
  }

  if (!unlink && pickupMode === undefined && displayName === undefined && !approverProvided) {
    return NextResponse.json({ error: 'no changes specified' }, { status: 400 })
  }

  const auth = await requireInternalMember(orgId)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  // 承認者の変更はガバナンス操作: org owner/admin のみに限定する（一般メンバーは不可）。
  if (approverProvided && !ADMIN_ROLES.has(auth.role)) {
    return NextResponse.json({ error: 'approver changes require owner/admin' }, { status: 403 })
  }

  const group = await verifyGroupInOrg(orgId, groupId)
  if (!group) {
    return NextResponse.json({ error: 'group not found' }, { status: 404 })
  }

  if (unlink) {
    await unlinkGroup(groupId)
    return NextResponse.json({ id: groupId, status: 'left' })
  }

  // 有料ゲート（フェーズ2・二重防御の設定時側）: all_plus_instant は pro/enterprise 限定。
  // entitlement判定のorgIdは常にサーバ側で確定した group.orgId を使う
  // （verifyGroupInOrgで検証済みのDB値。bodyの生orgIdは信用しない）。
  if (pickupMode === 'all_plus_instant') {
    const entitlements = await resolveOrgEntitlements(createAdminClient(), group.orgId)
    if (!entitlements.has('line_pickup_dual_mode')) {
      return NextResponse.json(
        { error: 'plan_required', feature: 'line_pickup_dual_mode' },
        { status: 403 },
      )
    }
  }

  if (approverProvided) {
    if (approverUserId) {
      // 死に設定を防ぐ: グループが space 紐付け済みで、対象がその space の admin/editor（＝
      // 承認時の _digest_actor_can_approve を満たし得る）であることを検証する。
      if (!group.spaceId) {
        return NextResponse.json(
          { error: 'group must be linked to a space before setting an approver' },
          { status: 400 },
        )
      }
      const internal = await isOrgInternalMember(orgId, approverUserId)
      const eligible = internal && (await isSpaceApproverEligible(group.spaceId, approverUserId))
      if (!eligible) {
        return NextResponse.json(
          { error: 'approver must be an admin/editor of the group space' },
          { status: 400 },
        )
      }
    }
    // 変更は原子的に（旧pendingを none へ戻し宙吊りを防ぐ）。pickup/displayName とは別処理で良い。
    await setGroupApprover(groupId, approverUserId ?? null)
  }

  if (pickupMode !== undefined || displayName !== undefined) {
    await updateChannelGroup(groupId, {
      ...(pickupMode !== undefined ? { pickupMode } : {}),
      ...(displayName !== undefined ? { displayName } : {}),
    })
  }
  return NextResponse.json({ id: groupId, ok: true })
}
