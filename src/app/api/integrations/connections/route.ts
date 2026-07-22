import { NextRequest, NextResponse } from 'next/server'
import { requireInternalMember } from '@/lib/channels/authz'
import { isValidUuid } from '@/lib/uuid'
import { createAdminClient } from '@/lib/supabase/admin'
import { implementedTaskSyncProviders } from '@/lib/task-sync/adapters'
import { sanitizeImportConfigForClient } from '@/lib/integrations/importConfig'

export const runtime = 'nodejs'

/**
 * 「ツール連携」タブが扱う provider（sink=通知連携とは別軸）。
 *
 * 従来の2本（multica / google_tasks は専用ワーカーが担当）に加え、アダプタ実装済みの
 * タスク同期ツールも返す。アダプタ登録表から導出しているので、**ツールを1本足したら
 * この一覧にも自動で載る**（ここに手で足す運用にすると必ず追従漏れが起きる）。
 */
function connectorProviders(): string[] {
  // generic_inbound は受信型でアダプタ登録表には載らないが、接続としては一覧に出す必要がある
  // （画面から受信口の状態と取り込み先設定を見せるため）。
  return ['multica', 'google_tasks', 'generic_inbound', ...implementedTaskSyncProviders()]
}

interface ConnectorConnectionRow {
  id: string
  provider: string
  status: string
  base_url: string | null
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
  /**
   * 受信口の呼び名（generic_inbound のみ）。1つのorgが複数の送信元を並べられる設計なので、
   * これが無いと画面で「どれがどの送信元か」を識別できない（接続IDの断片で代替するしかない）。
   * metadata には暗号化済みの鍵も入っているため、**呼び名だけを取り出して**返す。
   */
  label: string | null
  importEnabled: boolean
  importConfig: Record<string, unknown>
  createdAt: string | null
}

function toSummary(row: ConnectorConnectionRow): ConnectorConnectionSummary {
  // 接続先URLは2箇所にある: 新しいタスク同期は base_url 列、multica は metadata.multica.base_url
  // （列を足す前に作られた既存接続のため）。列を優先し、無ければ従来の場所を見る。
  const multica = (row.metadata?.multica as Record<string, unknown> | undefined) ?? undefined
  const baseUrl = row.base_url ?? (typeof multica?.base_url === 'string' ? multica.base_url : null)
  const generic = (row.metadata?.generic_inbound as Record<string, unknown> | undefined) ?? undefined
  const label = typeof generic?.label === 'string' ? generic.label : null
  return {
    id: row.id,
    provider: row.provider,
    status: row.status,
    baseUrl,
    label,
    importEnabled: row.import_enabled === true,
    // ⚠ kintone_app_tokens 等のクライアント非公開キーは絶対にそのまま返さない（暗号化済みでも
    // ブラウザ・React Queryのキャッシュ・devtoolsへ渡すべきではない。importConfig.ts 冒頭参照）。
    importConfig: sanitizeImportConfigForClient(row.import_config),
    createdAt: row.created_at,
  }
}

/**
 * GET /api/integrations/connections?orgId= — org の双方向同期接続の一覧
 * （multica / google_tasks ＋ アダプタ実装済みのタスク同期ツール）。
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
    .select('id, provider, status, base_url, import_enabled, import_config, metadata, created_at')
    .eq('org_id', orgId)
    .in('provider', connectorProviders())
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ error: `failed to list connections: ${error.message}` }, { status: 500 })
  }

  const connections = ((data as ConnectorConnectionRow[] | null) ?? []).map(toSummary)
  return NextResponse.json({ connections, viewerRole: auth.role })
}
