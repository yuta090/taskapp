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
/**
 * 受け付けるボディの上限。**認証の前に**バッファされるので、上限が無いと鍵を持たない相手でも
 * メモリを消費させられる。正当なイベント（1タスク分のJSON）は数KBに収まる。
 */
const MAX_BODY_BYTES = 64 * 1024

export async function POST(request: NextRequest) {
  try {
    // Content-Length があれば読む前に落とす（読んでから測るとその時点で消費済み）。
    const declaredLength = Number(request.headers.get('content-length') ?? '')
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'payload too large' }, { status: 413 })
    }
    const rawBody = await request.text()
    // Content-Length を付けない送信側（chunked）もあるので、実サイズでも確認する。
    if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'payload too large' }, { status: 413 })
    }
    const signature = request.headers.get('x-agentpm-signature')
    const result = await handleGenericInboundEvent(rawBody, signature)
    return NextResponse.json(result.body, { status: result.status })
  } catch (error) {
    // 想定外は理由を返さない（内部構造を推測させない）。送信側は再送してよい。
    console.error('generic inbound webhook: unhandled error', error)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}
