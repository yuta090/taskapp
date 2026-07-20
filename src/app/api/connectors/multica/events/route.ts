import { NextRequest, NextResponse } from 'next/server'
import { handleMulticaInboundEvent } from '@/lib/connectors/inbound'

export const runtime = 'nodejs'

/**
 * POST /api/connectors/multica/events — multica → TaskApp の完了/進捗Webhook受け口。
 * 契約: docs/spec/MULTICA_CONNECTOR_CONTRACT.md §4(受信)/§5(署名)/§6(冪等)/§7(拒否ケース)。
 *
 * 認証はマシン間の署名ベース(ユーザセッションを持たない)。署名は生ボディに対して検証するため、
 * ここではJSONパースせず text() で受ける(src/app/api/channels/line/webhook/route.ts と同じ
 * 薄いラッパーの流儀。処理本体は handleMulticaInboundEvent に委譲する)。
 */
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text()
    const signature = request.headers.get('x-agentpm-signature')
    const result = await handleMulticaInboundEvent(rawBody, signature)
    return NextResponse.json(result.body, { status: result.status })
  } catch (error) {
    console.error('multica inbound webhook: unhandled error', error)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}
