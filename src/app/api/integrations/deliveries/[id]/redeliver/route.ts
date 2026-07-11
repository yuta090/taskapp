import { NextRequest, NextResponse } from 'next/server'
import { requireOrgAdmin } from '@/lib/channels/authz'
import { isValidUuid } from '@/lib/uuid'
import { findDeliveryOrgId, redeliverDelivery } from '@/lib/sinks/store'
import { dispatchBatch } from '@/lib/sinks/dispatcher'

export const runtime = 'nodejs'

/**
 * POST /api/integrations/deliveries/[id]/redeliver — dead/failed → queued へリセット。owner/adminのみ。
 *
 * リセット後にベストエフォートの即時dispatchを1回試みる（失敗しても5分cronが拾うので結果整合。§2-2）。
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: deliveryId } = await params
  if (!isValidUuid(deliveryId)) {
    return NextResponse.json({ error: 'invalid delivery id' }, { status: 400 })
  }

  const orgId = await findDeliveryOrgId(deliveryId)
  if (!orgId) {
    return NextResponse.json({ error: 'delivery not found' }, { status: 404 })
  }

  const auth = await requireOrgAdmin(orgId)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const requeued = await redeliverDelivery(deliveryId)
  if (!requeued) {
    return NextResponse.json({ error: 'delivery is not dead/failed (nothing to redeliver)' }, { status: 409 })
  }

  await dispatchBatch({ totalLimit: 10, perSinkLimit: 10 }).catch((error) => {
    console.error('redeliver: best-effort immediate dispatch failed', error)
  })

  return NextResponse.json({ ok: true })
}
