import { NextRequest, NextResponse } from 'next/server'
import { requireInternalMember } from '@/lib/channels/authz'
import { findDigestTaskOrgId, promoteDigestTask, rejectDigestTask } from '@/lib/channels/store'
import { isValidUuid } from '@/lib/uuid'

export const runtime = 'nodejs'

/**
 * POST /api/channels/digest-tasks/approval — 申し送り候補の承認/却下（コンソール経路・Stage 2.7-B §5）
 *
 * {orgId, taskId, action: 'approve'|'reject'}
 * 内部メンバーのみ入口を通すが、実際の可否は RPC が再判定する
 * （_digest_actor_can_approve: 現責任者・org在籍・space admin/editor）。承認者本人でなければ 403。
 *
 * status → HTTP:
 *   promoted/rejected → 200（冪等再実行も同じ200）
 *   forbidden → 403 / not_found → 404 / conflict → 409
 */
export async function POST(request: NextRequest) {
  let parsed: unknown
  try {
    parsed = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  // 有効なJSONでも null / 配列 / プリミティブがあり得る。プロパティ参照前にオブジェクトを保証する
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const body = parsed as { orgId?: unknown; taskId?: unknown; action?: unknown }

  const orgId = typeof body.orgId === 'string' ? body.orgId : ''
  const taskId = typeof body.taskId === 'string' ? body.taskId : ''
  const action = typeof body.action === 'string' ? body.action : ''

  if (!isValidUuid(orgId) || !isValidUuid(taskId)) {
    return NextResponse.json({ error: 'orgId and taskId are required' }, { status: 400 })
  }
  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json({ error: 'action must be approve or reject' }, { status: 400 })
  }

  const auth = await requireInternalMember(orgId)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  // 越権・他orgの task を早期に弾く（RPC も org 束縛するが、明快な 404 を返すための防御）。
  const taskOrgId = await findDigestTaskOrgId(taskId)
  if (!taskOrgId || taskOrgId !== orgId) {
    return NextResponse.json({ error: 'task not found' }, { status: 404 })
  }

  if (action === 'approve') {
    const result = await promoteDigestTask(taskId, auth.userId)
    switch (result.status) {
      case 'promoted':
        return NextResponse.json({ status: 'promoted', created: result.created, taskId: result.taskId })
      case 'forbidden':
        return NextResponse.json({ error: 'forbidden' }, { status: 403 })
      case 'not_found':
        return NextResponse.json({ error: 'task not found' }, { status: 404 })
      case 'conflict':
      default:
        return NextResponse.json({ error: 'conflict' }, { status: 409 })
    }
  }

  const result = await rejectDigestTask(taskId, auth.userId)
  switch (result.status) {
    case 'rejected':
      return NextResponse.json({ status: 'rejected' })
    case 'forbidden':
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    case 'not_found':
      return NextResponse.json({ error: 'task not found' }, { status: 404 })
    case 'conflict':
    default:
      return NextResponse.json({ error: 'conflict' }, { status: 409 })
  }
}
