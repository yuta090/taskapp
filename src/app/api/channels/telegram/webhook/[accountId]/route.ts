import { NextRequest, NextResponse } from 'next/server'
import {
  handleTelegramWebhook,
  type TelegramWebhookDeps,
  type TelegramAccount,
} from '@/lib/channels/telegram/webhookHandler'
import {
  findChannelAccountCredentials,
  findActiveIdentitiesByExternalId,
  insertChannelMessage,
} from '@/lib/channels/store'

export const runtime = 'nodejs'

/**
 * POST /api/channels/telegram/webhook/[accountId] — Telegram Bot API webhook 受け口
 *
 * account 単位のパスで受け、X-Telegram-Bot-Api-Secret-Token を account の webhook_secret と
 * 照合して認証する（handler内）。署名検証は生ボディに対して行うため text() で受ける。
 */
const deps: TelegramWebhookDeps = {
  loadAccount: async (accountId): Promise<TelegramAccount | null> => {
    const acc = await findChannelAccountCredentials(accountId, 'telegram')
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
    findActiveIdentitiesByExternalId(orgId, 'telegram', externalId),
  insertMessage: (input) => insertChannelMessage(input),
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> },
) {
  try {
    const { accountId } = await params
    const rawBody = await request.text()
    const secretToken = request.headers.get('x-telegram-bot-api-secret-token')
    const result = await handleTelegramWebhook(accountId, rawBody, secretToken, deps)
    return NextResponse.json(result.body, { status: result.status })
  } catch (error) {
    console.error('Telegram webhook: unhandled error', error)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}
