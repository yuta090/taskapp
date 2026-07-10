import { NextRequest, NextResponse } from 'next/server'
import { handleLineWebhook } from '@/lib/channels/line/webhookHandler'

export const runtime = 'nodejs'

/**
 * POST /api/channels/line/webhook — LINE Messaging API webhook 受け口
 *
 * 認証は「アカウント別 channel secret による署名検証」（webhookHandler内）。
 * 署名検証は生ボディに対して行うため、ここではJSONパースせず text() で受ける。
 */
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text()
    const signature = request.headers.get('x-line-signature')
    const result = await handleLineWebhook(rawBody, signature)
    return NextResponse.json(result.body, { status: result.status })
  } catch (error) {
    console.error('LINE webhook: unhandled error', error)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}
