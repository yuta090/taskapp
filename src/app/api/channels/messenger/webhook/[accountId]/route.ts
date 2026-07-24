import { NextRequest, NextResponse } from 'next/server'
import {
  handleMessengerWebhook,
  verifyMessengerSubscription,
  type MessengerWebhookDeps,
  type MessengerAccount,
} from '@/lib/channels/messenger/webhookHandler'
import {
  findChannelAccountCredentials,
  findActiveIdentitiesByExternalId,
  insertChannelMessage,
  findValidLinkCode,
  linkIdentityViaCode,
  expireUserLinkCode,
} from '@/lib/channels/store'
import { extractUserLinkCode, hashUserLinkCode } from '@/lib/channels/userLink'
import { messengerAdapter } from '@/lib/channels/adapters/messenger'

export const runtime = 'nodejs'

/**
 * /api/channels/messenger/webhook/[accountId] — Facebook Messenger Platform 受け口
 *
 * GET  : 購読検証ハンドシェイク（hub.mode / hub.verify_token / hub.challenge）。
 *        account の verify_token と一致すれば challenge をプレーンテキストで返す。
 * POST : イベント。X-Hub-Signature-256 を account の app_secret と照合して認証する（handler内）。
 *        署名検証は生ボディに対して行うため text() で受ける。
 *
 * DM紐付け床: findLinkCode/linkIdentity/sendReply/expireLeakedUserCode を配線し、1:1で
 * 突合コードを送ると相手先(space)に紐付くフローを有効化する（handler内の分岐は
 * webhookHandler.ts のコメント参照）。linkIdentity は 'messenger' チャネルで identity を作る。
 */
const deps: MessengerWebhookDeps = {
  loadAccount: async (accountId): Promise<MessengerAccount | null> => {
    const acc = await findChannelAccountCredentials(accountId, 'messenger')
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
    findActiveIdentitiesByExternalId(orgId, 'messenger', externalId),
  insertMessage: (input) => insertChannelMessage(input),
  findLinkCode: (code) => findValidLinkCode(code),
  linkIdentity: (linkCode, externalUserId) =>
    linkIdentityViaCode(linkCode, externalUserId, 'messenger'),
  sendReply: async (account, to, text) => {
    // ベストエフォート: 送信失敗はwebhook処理を止めない（呼び出し元(safeSendReply)もcatchする）
    const result = await messengerAdapter({ credentials: account.credentials, to, text })
    if (!result.ok) {
      console.error('Messenger webhook: sendReply adapter failed', account.id, result.error)
    }
  },
  expireLeakedUserCode: async (bodyText) => {
    const code = extractUserLinkCode(bodyText)
    if (code) await expireUserLinkCode(hashUserLinkCode(code))
  },
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> },
) {
  try {
    const { accountId } = await params
    const sp = request.nextUrl.searchParams
    const result = await verifyMessengerSubscription(
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
    console.error('Messenger webhook verify: unhandled error', error)
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
    const result = await handleMessengerWebhook(accountId, rawBody, signature, deps)
    return NextResponse.json(result.body, { status: result.status })
  } catch (error) {
    console.error('Messenger webhook: unhandled error', error)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}
