import { NextRequest, NextResponse } from 'next/server'
import { requireOrgAdmin } from '@/lib/channels/authz'
import { isValidUuid } from '@/lib/uuid'
import { findSinkOrgId, redeliverSink } from '@/lib/sinks/store'
import { dispatchBatch } from '@/lib/sinks/dispatcher'

export const runtime = 'nodejs'

/**
 * POST /api/integrations/sinks/[id]/redeliver — sink単位でdead/failed全件をqueuedへリセット。owner/adminのみ。
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: sinkId } = await params
  if (!isValidUuid(sinkId)) {
    return NextResponse.json({ error: 'invalid sink id' }, { status: 400 })
  }

  const orgId = await findSinkOrgId(sinkId)
  if (!orgId) {
    return NextResponse.json({ error: 'sink not found' }, { status: 404 })
  }

  const auth = await requireOrgAdmin(orgId)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const count = await redeliverSink(sinkId)

  if (count > 0) {
    await dispatchBatch({ totalLimit: Math.min(count, 100), perSinkLimit: 100 }).catch((error) => {
      console.error('redeliver: best-effort immediate dispatch failed', error)
    })
  }

  return NextResponse.json({ ok: true, count })
}
