import { NextRequest } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { SLACK_CONFIG } from './config'

/**
 * Slack request の署名を検証する（リプレイ攻撃防止付き）
 * slash commands / interactions / webhook で共通利用
 */
export async function verifySlackRequest(request: NextRequest): Promise<{
  verified: boolean
  body: string
}> {
  const body = await request.text()
  const timestamp = request.headers.get('x-slack-request-timestamp') || ''
  const signature = request.headers.get('x-slack-signature') || ''

  // リプレイ攻撃防止（5分ウィンドウ）
  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - parseInt(timestamp, 10)) > 300) {
    return { verified: false, body }
  }

  if (!SLACK_CONFIG.signingSecret) {
    return { verified: false, body }
  }

  const sigBasestring = `v0:${timestamp}:${body}`
  const mySignature =
    'v0=' +
    createHmac('sha256', SLACK_CONFIG.signingSecret)
      .update(sigBasestring)
      .digest('hex')

  try {
    const verified = timingSafeEqual(
      Buffer.from(mySignature, 'utf8'),
      Buffer.from(signature, 'utf8'),
    )
    return { verified, body }
  } catch {
    return { verified: false, body }
  }
}
