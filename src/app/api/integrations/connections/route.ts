import { NextRequest, NextResponse } from 'next/server'
import { requireInternalMember } from '@/lib/channels/authz'
import { isValidUuid } from '@/lib/uuid'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

/** 双方向同期タブが扱う provider（sink=通知連携とは別軸）。 */
const CONNECTOR_PROVIDERS = ['multica', 'google_tasks'] as const

interface ConnectorConnectionRow {
  id: string
  provider: string
  status: string
  import_enabled: boolean | null
  import_config: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
  created_at: string | null
}

/** UIへ返す接続の要約。**secret（*_secret_encrypted）は一切含めない**（base_url のみ露出）。 */
interface ConnectorConnectionSummary {
  id: string
  provider: string
  status: string
  baseUrl: string | null
  importEnabled: boolean
  importConfig: Record<string, unknown>
  createdAt: string | null
}

function toSummary(row: ConnectorConnectionRow): ConnectorConnectionSummary {
  const multica = (row.metadata?.multica as Record<string, unknown> | undefined) ?? undefined
  const baseUrl = typeof multica?.base_url === 'string' ? multica.base_url : null
  return {
    id: row.id,
    provider: row.provider,
    status: row.status,
    baseUrl,
    importEnabled: row.import_enabled === true,
    importConfig: (row.import_config as Record<string, unknown> | null) ?? {},
    createdAt: row.created_at,
  }
}

/**
 * GET /api/integrations/connections?orgId= — org の双方向同期接続（multica / google_tasks）一覧。
 * 閲覧は internal member 可。編集（作成/ローテ/import_config）は owner/admin 限定（各変異APIが担保）。
 * **secret は返さない**（metadata から base_url だけ取り出す）。
 */
export async function GET(request: NextRequest) {
  const orgId = request.nextUrl.searchParams.get('orgId') ?? ''
  if (!isValidUuid(orgId)) {
    return NextResponse.json({ error: 'orgId is required' }, { status: 400 })
  }

  const auth = await requireInternalMember(orgId)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('integration_connections')
    .select('id, provider, status, import_enabled, import_config, metadata, created_at')
    .eq('org_id', orgId)
    .in('provider', CONNECTOR_PROVIDERS as unknown as string[])
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ error: `failed to list connections: ${error.message}` }, { status: 500 })
  }

  const connections = ((data as ConnectorConnectionRow[] | null) ?? []).map(toSummary)
  return NextResponse.json({ connections, viewerRole: auth.role })
}
