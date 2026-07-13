import { NextRequest, NextResponse } from 'next/server'
import { requireInternalMember } from '@/lib/channels/authz'
import { verifyGroupInOrg, updateChannelGroup, unlinkGroup, type PickupMode } from '@/lib/channels/store'
import { isValidUuid } from '@/lib/uuid'

export const runtime = 'nodejs'

const PICKUP_MODES: readonly PickupMode[] = ['all', 'mention_only', 'off']

function isPickupMode(value: unknown): value is PickupMode {
  return typeof value === 'string' && (PICKUP_MODES as readonly string[]).includes(value)
}

/**
 * PATCH /api/channels/groups — グループ管理（秘書コンソール用）
 *
 * {orgId, groupId, pickupMode?, displayName?, unlink?}
 * 内部メンバーのみ。groupIdのorg一致をサーバ側で検証する。
 * pickupMode: 'all'|'mention_only'|'off'（Stage 2.5 §1）。digestEnabledは廃止。
 * unlink: 誤紐付けの是正（status='left'化）。openな申し送りタスクのauto-dismissは
 * store層（unlinkGroup）で同一処理として行う。
 */
export async function PATCH(request: NextRequest) {
  let body: {
    orgId?: unknown
    groupId?: unknown
    pickupMode?: unknown
    displayName?: unknown
    unlink?: unknown
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
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

  if (!unlink && pickupMode === undefined && displayName === undefined) {
    return NextResponse.json({ error: 'no changes specified' }, { status: 400 })
  }

  const auth = await requireInternalMember(orgId)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const group = await verifyGroupInOrg(orgId, groupId)
  if (!group) {
    return NextResponse.json({ error: 'group not found' }, { status: 404 })
  }

  if (unlink) {
    await unlinkGroup(groupId)
    return NextResponse.json({ id: groupId, status: 'left' })
  }

  await updateChannelGroup(groupId, {
    ...(pickupMode !== undefined ? { pickupMode } : {}),
    ...(displayName !== undefined ? { displayName } : {}),
  })
  return NextResponse.json({ id: groupId, ok: true })
}
