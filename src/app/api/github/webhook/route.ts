import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  verifyWebhookSignature,
  parseWebhookHeaders,
  handlePullRequestEvent,
  handleInstallationEvent,
  handleInstallationRepositoriesEvent,
} from '@/lib/github'
import type { SupabaseClient } from '@supabase/supabase-js'

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

  // イベントログ保存。delivery_id が重複（23505）した場合は GitHub の再送。
  // 前回処理済み(processed=true)なら二重に副作用を起こさないようここで打ち切る。
  // 前回失敗(processed=false)なら、もう一度処理できるようそのまま進む。
  const { error: insertError } = await (getSupabaseAdmin() as SupabaseClient)
    .from('github_webhook_events')
    .insert({
      installation_id: data.installation?.id,
      event_type: event,
      action: data.action,
      delivery_id: delivery,
      payload: data,
      processed: false,
    })

  if (insertError) {
    if (delivery && (insertError as { code?: string }).code === '23505') {
      const { data: existing } = await (getSupabaseAdmin() as SupabaseClient)
        .from('github_webhook_events')
        .select('processed')
        .eq('delivery_id', delivery)
        .single()

      if ((existing as { processed?: boolean } | null)?.processed) {
        return NextResponse.json({ received: true, duplicate: true })
      }
      // processed=false（前回失敗）: 再送を活かしてもう一度処理する
    } else {
      console.error('Failed to record webhook event:', insertError)
    }
  }

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
      await (getSupabaseAdmin() as SupabaseClient)
        .from('github_webhook_events')
        .update({ processed: true })
        .eq('delivery_id', delivery)
    }

    return NextResponse.json({ received: true, ...result })
  } catch (err) {
    console.error('Webhook processing error:', err)

    // エラーログ更新。processed は成功時だけ true にするので、失敗時は false のまま
    // （後で拾い直せるように・GitHub からの再送でもう一度処理できるように）。
    if (delivery) {
      await (getSupabaseAdmin() as SupabaseClient)
        .from('github_webhook_events')
        .update({
          processed: false,
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
