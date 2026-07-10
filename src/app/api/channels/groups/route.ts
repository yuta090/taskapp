import { NextRequest, NextResponse } from 'next/server'
import { requireInternalMember } from '@/lib/channels/authz'
import { verifyGroupInOrg, updateChannelGroup, unlinkGroup } from '@/lib/channels/store'
import { isValidUuid } from '@/lib/uuid'

export const runtime = 'nodejs'

/**
 * PATCH /api/channels/groups — グループ管理（秘書コンソール用）
 *
 * {orgId, groupId, digestEnabled?, displayName?, unlink?}
 * 内部メンバーのみ。groupIdのorg一致をサーバ側で検証する。
 * unlink: 誤紐付けの是正（status='left'化）。openな申し送りタスクのauto-dismissは
 * store層（unlinkGroup）で同一処理として行う。
 */
export async function PATCH(request: NextRequest) {
  let body: {
    orgId?: unknown
    groupId?: unknown
    digestEnabled?: unknown
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
  const digestEnabled = typeof body.digestEnabled === 'boolean' ? body.digestEnabled : undefined
  const displayName = typeof body.displayName === 'string' ? body.displayName : undefined

  if (!unlink && digestEnabled === undefined && displayName === undefined) {
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
    ...(digestEnabled !== undefined ? { digestEnabled } : {}),
    ...(displayName !== undefined ? { displayName } : {}),
  })
  return NextResponse.json({ id: groupId, ok: true })
}
