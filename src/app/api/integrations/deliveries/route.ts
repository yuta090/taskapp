import { NextRequest, NextResponse } from 'next/server'
import { requireInternalMember } from '@/lib/channels/authz'
import { isValidUuid } from '@/lib/uuid'
import { listDeliveries } from '@/lib/sinks/store'

export const runtime = 'nodejs'

const MAX_LIMIT = 200
const DEFAULT_LIMIT = 50

/**
 * GET /api/integrations/deliveries?orgId=&sinkId=&taskId=&before=&limit= — 配達ログ（ページング）。
 * 内部メンバーなら閲覧可。beforeはcreated_atのISO文字列(次ページ取得用カーソル)。
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const orgId = params.get('orgId') ?? ''
  if (!isValidUuid(orgId)) {
    return NextResponse.json({ error: 'orgId is required' }, { status: 400 })
  }

  const auth = await requireInternalMember(orgId)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const sinkId = params.get('sinkId') ?? undefined
  if (sinkId !== undefined && !isValidUuid(sinkId)) {
    return NextResponse.json({ error: 'invalid sinkId' }, { status: 400 })
  }

  const taskId = params.get('taskId') ?? undefined
  if (taskId !== undefined && !isValidUuid(taskId)) {
    return NextResponse.json({ error: 'invalid taskId' }, { status: 400 })
  }

  const beforeCreatedAt = params.get('before') ?? undefined

  const limitParam = params.get('limit')
  const limit = limitParam ? Math.min(Math.max(Number(limitParam) || DEFAULT_LIMIT, 1), MAX_LIMIT) : DEFAULT_LIMIT

  const deliveries = await listDeliveries({ orgId, sinkId, taskId, beforeCreatedAt, limit })

  return NextResponse.json({ deliveries })
}
