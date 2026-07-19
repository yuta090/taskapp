import { NextRequest, NextResponse } from 'next/server'
import {
  handleChatworkWebhook,
  type ChatworkWebhookDeps,
  type ChatworkAccount,
} from '@/lib/channels/chatwork/webhookHandler'
import {
  findChannelAccountCredentials,
  findActiveIdentitiesByExternalId,
  insertChannelMessage,
} from '@/lib/channels/store'

export const runtime = 'nodejs'

/**
 * POST /api/channels/chatwork/webhook/[accountId] — Chatwork Webhook v2 受け口
 *
 * account 単位のパスで受け、X-ChatWorkWebhookSignature を account の webhook_token と
 * 照合して認証する（handler内）。署名検証は生ボディに対して行うため text() で受ける。
 */
const deps: ChatworkWebhookDeps = {
  loadAccount: async (accountId): Promise<ChatworkAccount | null> => {
    const acc = await findChannelAccountCredentials(accountId, 'chatwork')
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
    findActiveIdentitiesByExternalId(orgId, 'chatwork', externalId),
  insertMessage: (input) => insertChannelMessage(input),
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> },
) {
  try {
    const { accountId } = await params
    const rawBody = await request.text()
    const signature = request.headers.get('x-chatworkwebhooksignature')
    const result = await handleChatworkWebhook(accountId, rawBody, signature, deps)
    return NextResponse.json(result.body, { status: result.status })
  } catch (error) {
    console.error('Chatwork webhook: unhandled error', error)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}
