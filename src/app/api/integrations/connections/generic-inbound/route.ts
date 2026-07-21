import { NextRequest, NextResponse } from 'next/server'
import { requireOrgAdmin } from '@/lib/channels/authz'
import { isValidUuid } from '@/lib/uuid'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateConnectorSecret, encryptConnectorSecret } from '@/lib/connectors/secrets'

export const runtime = 'nodejs'

/**
 * POST /api/integrations/connections/generic-inbound — 汎用Webhook受信の接続を作る。
 *
 * 公開APIが無い/弱いツール向けの受け口。**こちらから外部を叩かない**ので、他のタスク同期接続と
 * 違って接続先URLもAPIキーも預からない。渡すのは「送り先URL」と「署名用の鍵」だけ。
 *
 * 鍵は作成時に一度だけ平文で返す（以後の取得経路は無い）。sink や multica 接続と同じ方式で
 * 暗号化して保存する。再発行が必要なら接続を作り直す（鍵のローテーションは別途）。
 */

interface CreateBody {
  org_id?: unknown
  /** 表示用の呼び名（「ANDPAD経由」等）。運用者が複数の送信元を見分けるためだけに使う。 */
  label?: unknown
}

function webhookUrl(): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  return `${appUrl}/api/connectors/generic/events`
}

export async function POST(request: NextRequest) {
  let body: CreateBody
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

  const label = typeof body.label === 'string' ? body.label.trim().slice(0, 100) : ''
  // 複数の送信元（ツールごと）を並べられるよう、接続の識別子に呼び名を使う。
  // 空なら null＝この org で1接続のみ（一意インデックスが coalesce(...,'') で効く）。
  const externalAccountKey = label ? label.toLowerCase() : null

  const plaintextSecret = generateConnectorSecret()
  const encrypted = await encryptConnectorSecret(plaintextSecret)

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('integration_connections')
    .insert({
      provider: 'generic_inbound',
      owner_type: 'org',
      owner_id: orgId,
      org_id: orgId,
      // access_token は NOT NULL。この接続は外部を叩かないので提示すべきトークンが無い。
      access_token: '',
      auth_kind: 'shared_secret',
      external_account_key: externalAccountKey,
      status: 'active',
      // 取り込み先スペースを設定するまで受信を受け付けない（未設定だと受信が422で弾かれる）。
      import_enabled: false,
      metadata: { generic_inbound: { label: label || null, receive_secret_encrypted: encrypted } },
    })
    .select('id')
    .single()

  if (error || !data) {
    if ((error as { code?: string } | null)?.code === '23505') {
      return NextResponse.json(
        { error: 'この呼び名の受信口は既にあります（別の呼び名を付けてください）' },
        { status: 409 },
      )
    }
    console.error('[generic-inbound] insert failed:', (error as { message?: string } | null)?.message)
    return NextResponse.json({ error: '受信口の作成に失敗しました' }, { status: 500 })
  }

  return NextResponse.json(
    {
      connection_id: (data as { id: string }).id,
      webhook_url: webhookUrl(),
      // 平文はこの応答でしか返さない。画面で控えてもらう。
      receive_secret: plaintextSecret,
    },
    { status: 201 },
  )
}
