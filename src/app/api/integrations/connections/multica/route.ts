import { NextRequest, NextResponse } from 'next/server'
import { requireOrgAdmin } from '@/lib/channels/authz'
import { isValidUuid } from '@/lib/uuid'
import { validateWebhookUrl } from '@/lib/sinks/ssrf'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateConnectorSecret, encryptConnectorSecret } from '@/lib/connectors/secrets'

export const runtime = 'nodejs'

interface CreateMulticaConnectionBody {
  org_id?: unknown
  base_url?: unknown
}

/** multica → TaskApp の受信Webhook絶対URL(既存のOAuth callback URL構築と同じ NEXT_PUBLIC_APP_URL 流儀)。 */
function webhookUrl(): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  return `${appUrl}/api/connectors/multica/events`
}

/**
 * POST /api/integrations/connections/multica — multica接続を作成する。owner/adminのみ。
 *
 * send(TaskApp→multica)/receive(multica→TaskApp)の2本の鍵を生成し、sink
 * (src/lib/sinks/store.ts createWebhookSink)と同方式で暗号化して
 * metadata.multica.{send,receive}_secret_encrypted に保存する。平文は作成時に一度だけ返す
 * (以後の取得経路は無い)。平文フォールバックは持たない(本ブランチ未マージ=既存データ無し)。
 *
 * base_url はSSRF検証(validateWebhookUrl)を通す(https限定・ポート443限定・private/loopback拒否)。
 */
export async function POST(request: NextRequest) {
  let body: CreateMulticaConnectionBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const orgId = typeof body.org_id === 'string' ? body.org_id : ''
  if (!isValidUuid(orgId)) {
    return NextResponse.json({ error: 'org_id is required' }, { status: 400 })
  }

  const auth = await requireOrgAdmin(orgId)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const baseUrl = typeof body.base_url === 'string' ? body.base_url : ''
  if (!baseUrl) {
    return NextResponse.json({ error: 'base_url is required' }, { status: 400 })
  }
  const validation = await validateWebhookUrl(baseUrl)
  if (!validation.ok) {
    return NextResponse.json({ error: `invalid base_url: ${validation.reason}` }, { status: 400 })
  }

  const plaintextSendSecret = generateConnectorSecret()
  const plaintextReceiveSecret = generateConnectorSecret()
  const [sendSecretEncrypted, receiveSecretEncrypted] = await Promise.all([
    encryptConnectorSecret(plaintextSendSecret),
    encryptConnectorSecret(plaintextReceiveSecret),
  ])

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('integration_connections')
    .insert({
      provider: 'multica',
      owner_type: 'org',
      owner_id: orgId,
      org_id: orgId,
      // multicaはOAuthを使わない(署名ベースの資格情報のみ)ため access_token 列は空文字で満たす
      // (integration_connections.access_token は既存の not null 制約を持つ)。
      access_token: '',
      status: 'active',
      metadata: {
        multica: {
          base_url: baseUrl,
          send_secret_encrypted: sendSecretEncrypted,
          receive_secret_encrypted: receiveSecretEncrypted,
        },
      },
    })
    .select('id')
    .single()

  if (error || !data) {
    // unique(provider, owner_type, owner_id): org あたり multica 接続は1件。2回目は 23505。
    // 制約名(内部スキーマ)を漏らさないクリーンな 409 にマップする。
    if ((error as { code?: string } | null)?.code === '23505') {
      return NextResponse.json(
        {
          error:
            'この組織には既に multica 接続があります。作り直す場合は既存接続を削除するか、鍵をローテーションしてください。',
        },
        { status: 409 },
      )
    }
    console.error('[connections/multica] insert failed:', (error as { message?: string } | null)?.message)
    return NextResponse.json({ error: 'failed to create connection' }, { status: 500 })
  }

  return NextResponse.json(
    {
      connection_id: (data as { id: string }).id,
      base_url: baseUrl,
      webhook_url: webhookUrl(),
      send_secret: plaintextSendSecret,
      receive_secret: plaintextReceiveSecret,
    },
    { status: 201 },
  )
}
