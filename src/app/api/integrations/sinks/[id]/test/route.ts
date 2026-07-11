import { NextRequest, NextResponse } from 'next/server'
import { requireOrgAdmin } from '@/lib/channels/authz'
import { isValidUuid } from '@/lib/uuid'
import { findSinkOrgId, findDeliverableSink, insertPingDelivery } from '@/lib/sinks/store'
import { dispatchClaimedDelivery } from '@/lib/sinks/dispatcher'
import { testNotionConnection } from '@/lib/sinks/adapters/notion'

export const runtime = 'nodejs'

/**
 * POST /api/integrations/sinks/[id]/test — テスト配達。owner/adminのみ。
 *
 * webhook: event:'ping'。SSRF検証は findDeliverableSink → dispatchClaimedDelivery →
 * deliverWebhook → safeFetch と本配送と全く同じ経路(safeFetch)を通る
 * （§2-3: 登録時・test・本配送の3経路が同じ関数を通る要件）。
 * notion: pingページを作らず、databaseへのquery1件で接続とdatabaseアクセスを検証する(§3)。
 * いずれもキューを経由せず即時実行し、結果を同期的に返す。
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
      { error: 'sink is not deliverable (unsupported provider or missing secret/connection)' },
      { status: 400 },
    )
  }

  if (sink.provider === 'notion') {
    // webhook側(dispatchClaimedDelivery)のoutcome形状('sent'|'failed'|'dead'の文字列)に
    // 揃える。notionはHTTPレスポンスの詳細を持つため、error/responseStatusを併記する。
    const result = await testNotionConnection(sink)
    return NextResponse.json({
      deliveryId: null,
      outcome: result.ok ? 'sent' : 'failed',
      ...(result.responseStatus !== undefined ? { responseStatus: result.responseStatus } : {}),
      ...(result.error !== undefined ? { error: result.error } : {}),
    })
  }

  const delivery = await insertPingDelivery({ id: sinkId, orgId })
  const outcome = await dispatchClaimedDelivery(delivery, sink)

  return NextResponse.json({ deliveryId: delivery.id, outcome })
}
