import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  verifyWebhookSignature,
  parseWebhookHeaders,
  handlePullRequestEvent,
  handleInstallationEvent,
  handleInstallationRepositoriesEvent,
} from '@/lib/github'

// Webhookはbodyをrawで受け取る必要がある
export const runtime = 'nodejs'

let _supabaseAdmin: ReturnType<typeof createClient> | null = null
function getSupabaseAdmin() {
  if (!_supabaseAdmin) {
    _supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _supabaseAdmin
}

export async function POST(request: NextRequest) {
  const payload = await request.text()
  const { event, delivery, signature } = parseWebhookHeaders(request.headers)

  // 署名検証
  if (!verifyWebhookSignature(payload, signature)) {
    console.error('Invalid webhook signature')
    return NextResponse.json(
      { error: 'Invalid signature' },
      { status: 401 }
    )
  }

  const data = JSON.parse(payload)

  // イベントログ保存
  await (getSupabaseAdmin() as any).from('github_webhook_events').insert({
    installation_id: data.installation?.id,
    event_type: event,
    action: data.action,
    delivery_id: delivery,
    payload: data,
    processed: false,
  })

  try {
    let result = { success: true }

    // イベント種別に応じた処理
    switch (event) {
      case 'pull_request':
        result = await handlePullRequestEvent(data)
        break

      case 'installation':
        result = await handleInstallationEvent(data)
        break

      case 'installation_repositories':
        result = await handleInstallationRepositoriesEvent(data)
        break

      case 'ping':
        // GitHub からの疎通確認
        console.log('Received ping from GitHub')
        break

      default:
        console.log(`Unhandled event type: ${event}`)
    }

    // 処理済みマーク
    if (delivery) {
      await (getSupabaseAdmin() as any)
        .from('github_webhook_events')
        .update({ processed: true })
        .eq('delivery_id', delivery)
    }

    return NextResponse.json({ received: true, ...result })
  } catch (err) {
    console.error('Webhook processing error:', err)

    // エラーログ更新
    if (delivery) {
      await (getSupabaseAdmin() as any)
        .from('github_webhook_events')
        .update({
          processed: true,
          error_message: err instanceof Error ? err.message : 'Unknown error',
        })
        .eq('delivery_id', delivery)
    }

    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    )
  }
}
