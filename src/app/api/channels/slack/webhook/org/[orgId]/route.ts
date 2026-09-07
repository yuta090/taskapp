import { NextRequest, NextResponse } from 'next/server'
import { handleSlackWebhook } from '@/lib/channels/slack/webhookHandler'
import { slackWebhookDeps } from '@/lib/channels/slack/webhookDeps'
import { findActiveOrgAccountId, MultipleOrgAccountsError } from '@/lib/channels/store'
import { isValidUuid } from '@/lib/uuid'

export const runtime = 'nodejs'

/**
 * POST /api/channels/slack/webhook/org/[orgId] — Slack Events API の「組織単位」受け口。
 *
 * 目的: 利用者が Slack アプリを作る前に受信URLを確定させ、AgentPM が用意した設定ファイル
 * （secretaryManifest）に埋め込めるようにする。account 単位URL（…/webhook/[accountId]）は
 * 鍵の登録後にしか分からず、Slack と AgentPM を往復させる原因になっていた。
 *
 * 動き:
 *   - org の自社 Slack account（owner_type='org'・active）があれば、その account に解決して
 *     account 単位URLと同じ処理（署名検証込み）に委ねる。
 *   - まだ無い（アプリ作成直後・鍵の登録前）場合は、Slack の URL 確認（url_verification）にだけ
 *     challenge を返す。これは Slack が「このURLは本当にあなたのものか」を確かめる公開の手続きで、
 *     challenge は Slack が生成した使い捨ての文字列。秘密情報を含まず、返しても何も漏れない。
 *     それ以外は 401（未検証の本文は解釈も保存もしない）。
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
) {
  try {
    const { orgId } = await params
    if (!isValidUuid(orgId)) {
      return NextResponse.json({ error: 'invalid orgId' }, { status: 400 })
    }
    const rawBody = await request.text()

    let accountId: string | null
    try {
      accountId = await findActiveOrgAccountId(orgId, 'slack')
    } catch (error) {
      if (error instanceof MultipleOrgAccountsError) {
        return NextResponse.json({ error: 'multiple accounts' }, { status: 409 })
      }
      throw error
    }

    if (!accountId) {
      // 登録前の URL 確認だけ通す（上記コメント参照）。本文はこの判定のためだけに読む。
      let data: { type?: string; challenge?: string } | null = null
      try {
        data = JSON.parse(rawBody)
      } catch {
        data = null
      }
      if (data?.type === 'url_verification' && typeof data.challenge === 'string') {
        return NextResponse.json({ challenge: data.challenge }, { status: 200 })
      }
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }

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
    console.error('Slack webhook (org): unhandled error', error)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}
