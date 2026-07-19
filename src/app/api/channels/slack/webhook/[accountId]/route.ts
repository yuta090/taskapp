import { NextRequest, NextResponse } from 'next/server'
import {
  handleSlackWebhook,
  type SlackWebhookDeps,
  type SlackAccount,
} from '@/lib/channels/slack/webhookHandler'
import {
  findChannelAccountCredentials,
  findActiveIdentitiesByExternalId,
  insertChannelMessage,
} from '@/lib/channels/store'

export const runtime = 'nodejs'

/**
 * POST /api/channels/slack/webhook/[accountId] — Slack Events API 受け口（channel_accounts 系統）
 *
 * ⚠ 旧統合 /api/slack/webhook（slack_workspaces）とは別系統。こちらは account 単位パスで受け、
 * その account の signing_secret で v0 署名＋リプレイ窓を検証する（handler内）。
 * 署名検証は生ボディに対して行うため text() で受ける。
 */
const deps: SlackWebhookDeps = {
  loadAccount: async (accountId): Promise<SlackAccount | null> => {
    const acc = await findChannelAccountCredentials(accountId, 'slack')
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
    findActiveIdentitiesByExternalId(orgId, 'slack', externalId),
  insertMessage: (input) => insertChannelMessage(input),
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> },
) {
  try {
    const { accountId } = await params
    const rawBody = await request.text()
    const result = await handleSlackWebhook(
      accountId,
      rawBody,
      {
        signature: request.headers.get('x-slack-signature'),
        timestamp: request.headers.get('x-slack-request-timestamp'),
        nowSeconds: Math.floor(Date.now() / 1000),
      },
      deps,
    )
    return NextResponse.json(result.body, { status: result.status })
  } catch (error) {
    console.error('Slack webhook (channel_accounts): unhandled error', error)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}
