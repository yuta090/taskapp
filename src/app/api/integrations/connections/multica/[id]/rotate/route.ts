import { NextRequest, NextResponse } from 'next/server'
import { requireOrgAdmin } from '@/lib/channels/authz'
import { isValidUuid } from '@/lib/uuid'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateConnectorSecret, encryptConnectorSecret } from '@/lib/connectors/secrets'

export const runtime = 'nodejs'

interface MulticaConnectionRow {
  id: string
  org_id: string
  provider: string
  metadata: Record<string, unknown> | null
}

async function findMulticaConnection(id: string): Promise<MulticaConnectionRow | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('integration_connections')
    .select('id, org_id, provider, metadata')
    .eq('id', id)
    .eq('provider', 'multica')
    .maybeSingle()
  if (error || !data) return null
  return data as MulticaConnectionRow
}

type Direction = 'send' | 'receive'

/**
 * POST /api/integrations/connections/multica/[id]/rotate?direction=send|receive
 * owner/adminのみ。
 *
 * 対象方向の鍵だけを再生成・暗号化して保存し、他方向の鍵・base_urlは保持する
 * (src/lib/sinks/store.ts rotateWebhookSecretと同方式)。平文は一度だけ返す。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: 'invalid connection id' }, { status: 400 })
  }

  const directionParam = request.nextUrl.searchParams.get('direction')
  if (directionParam !== 'send' && directionParam !== 'receive') {
    return NextResponse.json({ error: "direction must be 'send' or 'receive'" }, { status: 400 })
  }
  const direction: Direction = directionParam

  const connection = await findMulticaConnection(id)
  if (!connection) {
    return NextResponse.json({ error: 'connection not found' }, { status: 404 })
  }

  const auth = await requireOrgAdmin(connection.org_id)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const plaintextSecret = generateConnectorSecret()
  const secretEncrypted = await encryptConnectorSecret(plaintextSecret)

  const currentMulticaMeta = (connection.metadata?.multica as Record<string, unknown> | undefined) ?? {}
  const field = direction === 'send' ? 'send_secret_encrypted' : 'receive_secret_encrypted'
  const nextMetadata = {
    ...connection.metadata,
    multica: { ...currentMulticaMeta, [field]: secretEncrypted },
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from('integration_connections')
    .update({ metadata: nextMetadata })
    .eq('id', id)
    .eq('provider', 'multica')

  if (error) {
    return NextResponse.json({ error: `failed to rotate secret: ${error.message}` }, { status: 500 })
  }

  return NextResponse.json({ direction, secret: plaintextSecret }, { status: 200 })
}
