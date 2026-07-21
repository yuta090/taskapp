import { NextRequest, NextResponse } from 'next/server'
import { handleGenericInboundEvent } from '@/lib/connectors/genericInbound'

export const runtime = 'nodejs'

/**
 * POST /api/connectors/generic/events — 汎用Webhookの受け口。
 *
 * 公開APIが無い/弱いツールを、Zapier / Make / n8n など「送れる側」経由で繋ぐための入口。
 * 認証はマシン間の署名ベース（ユーザーセッションを持たない）。**署名は生ボディに対して**検証する
 * ため、ここではJSONパースせず text() で受ける（multica の受け口と同じ薄いラッパーの流儀。
 * 処理本体は handleGenericInboundEvent に委譲する）。
 *
 * 送信側は非2xxを受けたら再送してよい（副作用は冪等・記録は副作用成功後）。
 */
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text()
    const signature = request.headers.get('x-agentpm-signature')
    const result = await handleGenericInboundEvent(rawBody, signature)
    return NextResponse.json(result.body, { status: result.status })
  } catch (error) {
    // 想定外は理由を返さない（内部構造を推測させない）。送信側は再送してよい。
    console.error('generic inbound webhook: unhandled error', error)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}
