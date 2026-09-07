import { NextRequest, NextResponse } from 'next/server'
import { handleSlackWebhook } from '@/lib/channels/slack/webhookHandler'
import { slackWebhookDeps } from '@/lib/channels/slack/webhookDeps'

export const runtime = 'nodejs'

/**
 * POST /api/channels/slack/webhook/[accountId] — Slack Events API 受け口（channel_accounts 系統）
 *
 * ⚠ 旧統合 /api/slack/webhook（slack_workspaces）とは別系統。こちらは account 単位パスで受け、
 * その account の signing_secret で v0 署名＋リプレイ窓を検証する（handler内）。
 * 署名検証は生ボディに対して行うため text() で受ける。
 *
 * deps の配線は src/lib/channels/slack/webhookDeps.ts（組織単位URLと共用）。
 */
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
      slackWebhookDeps,
    )
    return NextResponse.json(result.body, { status: result.status })
  } catch (error) {
    console.error('Slack webhook (channel_accounts): unhandled error', error)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}
