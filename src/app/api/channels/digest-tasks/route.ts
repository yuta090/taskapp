import { NextRequest, NextResponse } from 'next/server'
import { requireInternalMember } from '@/lib/channels/authz'
import { findDigestTaskOrgId, updateDigestTaskStatusConsole } from '@/lib/channels/store'
import { isValidUuid } from '@/lib/uuid'

export const runtime = 'nodejs'

const VALID_STATUSES = new Set(['done', 'dismissed', 'open'])

/**
 * PATCH /api/channels/digest-tasks — 申し送りタスクの消し込み/復旧（秘書コンソール用）
 *
 * {orgId, taskId, status: 'done'|'dismissed'|'open'}
 * 内部メンバーのみ。taskIdのorg一致をサーバ側で検証する。done_via='console'（store層で設定）。
 * openへの復旧はdone_*をクリアする（store層のupdateDigestTaskStatusConsoleで実施）。
 */
export async function PATCH(request: NextRequest) {
  let body: { orgId?: unknown; taskId?: unknown; status?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const orgId = typeof body.orgId === 'string' ? body.orgId : ''
  const taskId = typeof body.taskId === 'string' ? body.taskId : ''
  const status = typeof body.status === 'string' ? body.status : ''

  if (!isValidUuid(orgId) || !isValidUuid(taskId)) {
    return NextResponse.json({ error: 'orgId and taskId are required' }, { status: 400 })
  }
  if (!VALID_STATUSES.has(status)) {
    return NextResponse.json({ error: 'status must be done, dismissed, or open' }, { status: 400 })
  }

  const auth = await requireInternalMember(orgId)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const taskOrgId = await findDigestTaskOrgId(taskId)
  if (!taskOrgId || taskOrgId !== orgId) {
    return NextResponse.json({ error: 'task not found' }, { status: 404 })
  }

  const updated = await updateDigestTaskStatusConsole(
    taskId,
    status as 'done' | 'dismissed' | 'open',
  )
  if (!updated) {
    return NextResponse.json({ error: 'task not found' }, { status: 404 })
  }

  return NextResponse.json({ id: taskId, status })
}
