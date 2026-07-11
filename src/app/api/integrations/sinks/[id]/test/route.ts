import { NextRequest, NextResponse } from 'next/server'
import { requireOrgAdmin } from '@/lib/channels/authz'
import { isValidUuid } from '@/lib/uuid'
import { findSinkOrgId, findDeliverableSink, insertPingDelivery } from '@/lib/sinks/store'
import { dispatchClaimedDelivery } from '@/lib/sinks/dispatcher'

export const runtime = 'nodejs'

/**
 * POST /api/integrations/sinks/[id]/test — テスト配達（event: 'ping'）。owner/adminのみ。
 *
 * SSRF検証は findDeliverableSink → dispatchClaimedDelivery → deliverWebhook → safeFetch と
 * 本配送と全く同じ経路(safeFetch)を通る（§2-3: 登録時・test・本配送の3経路が同じ関数を通る要件）。
 * キューを経由せず即時実行し、結果を同期的に返す。
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

  const sink = await findDeliverableSink(sinkId)
  if (!sink) {
    return NextResponse.json(
      { error: 'sink is not deliverable (unsupported provider or missing secret)' },
      { status: 400 },
    )
  }

  const delivery = await insertPingDelivery({ id: sinkId, orgId })
  const outcome = await dispatchClaimedDelivery(delivery, sink)

  return NextResponse.json({ deliveryId: delivery.id, outcome })
}
