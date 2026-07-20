import { NextRequest, NextResponse } from 'next/server'
import {
  handleWhatsappWebhook,
  verifyWhatsappSubscription,
  type WhatsappWebhookDeps,
  type WhatsappAccount,
} from '@/lib/channels/whatsapp/webhookHandler'
import {
  findChannelAccountCredentials,
  findActiveIdentitiesByExternalId,
  insertChannelMessage,
} from '@/lib/channels/store'

export const runtime = 'nodejs'

/**
 * /api/channels/whatsapp/webhook/[accountId] — WhatsApp Cloud API 受け口
 *
 * GET  : 購読検証ハンドシェイク（hub.mode / hub.verify_token / hub.challenge）。
 *        account の verify_token と一致すれば challenge をプレーンテキストで返す。
 * POST : イベント。X-Hub-Signature-256 を account の app_secret と照合して認証する（handler内）。
 *        署名検証は生ボディに対して行うため text() で受ける。
 */
const deps: WhatsappWebhookDeps = {
  loadAccount: async (accountId): Promise<WhatsappAccount | null> => {
    const acc = await findChannelAccountCredentials(accountId, 'whatsapp')
    if (!acc) return null
    return {
      id: acc.id,
      channel: acc.channel,
      orgId: acc.orgId,
      ownerType: acc.ownerType,
      status: acc.status,
      credentials: acc.credentials,
    }
  },
  findIdentities: (orgId, externalId) =>
    findActiveIdentitiesByExternalId(orgId, 'whatsapp', externalId),
  insertMessage: (input) => insertChannelMessage(input),
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> },
) {
  try {
    const { accountId } = await params
    const sp = request.nextUrl.searchParams
    const result = await verifyWhatsappSubscription(
      accountId,
      sp.get('hub.mode'),
      sp.get('hub.verify_token'),
      sp.get('hub.challenge'),
      deps,
    )
    // Meta は challenge の生テキスト（数値文字列）をそのまま期待する
    return new NextResponse(result.body, {
      status: result.status,
      headers: { 'Content-Type': 'text/plain' },
    })
  } catch (error) {
    console.error('WhatsApp webhook verify: unhandled error', error)
    return new NextResponse('error', { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> },
) {
  try {
    const { accountId } = await params
    const rawBody = await request.text()
    const signature = request.headers.get('x-hub-signature-256')
    const result = await handleWhatsappWebhook(accountId, rawBody, signature, deps)
    return NextResponse.json(result.body, { status: result.status })
  } catch (error) {
    console.error('WhatsApp webhook: unhandled error', error)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}
