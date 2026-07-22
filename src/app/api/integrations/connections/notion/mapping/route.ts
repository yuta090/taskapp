import { NextRequest, NextResponse } from 'next/server'
import { requireOrgAdmin } from '@/lib/channels/authz'
import { isValidUuid } from '@/lib/uuid'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCredentials, type ConnectionCredentialRow } from '@/lib/task-sync/credentials'
import { fetchDatabaseSchema } from '@/lib/task-sync/providers/notion/schema'
import { parseNotionMapping, validateMappingAgainstSchema } from '@/lib/task-sync/providers/notion/mapping'
import { toLiveProperties } from '@/lib/task-sync/providers/notion/mappingWizard'

export const runtime = 'nodejs'

/**
 * PUT /api/integrations/connections/notion/mapping
 *
 * 「AI提案＋人が1回確認」方式（設計確定済み・変更しない）のうち、確認・確定を保存する側。
 *
 * ⚠ 最重要の信頼境界: クライアントが送ってきた mapping も、提案API(propose)が返した提案も
 * 一切信用しない。ここで**サーバ側がライブスキーマを再取得**し、validateMappingAgainstSchema を
 * 通した結果だけを保存する。検証は必ずこの1箇所（保存の直前）で行う。
 *
 * confirmed_at は常にサーバ側の現在時刻を入れる（クライアント指定値は採用しない。タイムスタンプ
 * なので toISOString() を使ってよい — CLAUDE.md の禁止はローカル日付の生成/表示についてであり、
 * 監査用タイムスタンプには適用されない。既存コードベースでも updated_at 等はこの形で統一されている）。
 *
 * マッピングを確定する＝そのDBを取り込む意思表示なので、notion_mappings[database_id] の更新と
 * read_container_ids への database_id 追加を1回の更新にまとめる（他のキーは保持したまま部分更新する）。
 */

interface PutBody {
  org_id?: unknown
  connection_id?: unknown
  database_id?: unknown
  mapping?: unknown
}

interface NotionConnectionRow extends ConnectionCredentialRow {
  org_id: string
  provider: string
  import_config: Record<string, unknown> | null
}

/** connection_id を org_id・provider='notion' の境界付きで引く。他orgの接続は絶対に引けない。 */
async function findNotionConnection(connectionId: string, orgId: string): Promise<NotionConnectionRow | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('integration_connections')
    .select(
      'id, org_id, provider, auth_kind, base_url, access_token_encrypted, refresh_token_encrypted, refresh_token, import_config',
    )
    .eq('id', connectionId)
    .eq('org_id', orgId)
    .eq('provider', 'notion')
    .maybeSingle()
  if (error || !data) return null
  return data as NotionConnectionRow
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export async function PUT(request: NextRequest) {
  let body: PutBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const orgId = typeof body.org_id === 'string' ? body.org_id : ''
  const connectionId = typeof body.connection_id === 'string' ? body.connection_id : ''
  const databaseId = typeof body.database_id === 'string' ? body.database_id.trim() : ''

  if (!isValidUuid(orgId)) {
    return NextResponse.json({ error: 'org_id is required' }, { status: 400 })
  }
  if (!isValidUuid(connectionId)) {
    return NextResponse.json({ error: 'connection_id is required' }, { status: 400 })
  }
  if (!databaseId) {
    return NextResponse.json({ error: 'database_id is required' }, { status: 400 })
  }

  const auth = await requireOrgAdmin(orgId)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  if (typeof body.mapping !== 'object' || body.mapping === null || Array.isArray(body.mapping)) {
    return NextResponse.json({ error: 'mapping must be an object' }, { status: 400 })
  }

  // confirmed_at は常にサーバ側の現在時刻。クライアントが何を送ってきても上書きする
  // (spread の後にconfirmed_atを置くことで、クライアント送信値を無条件に上書きする)。
  const rawMapping = { ...(body.mapping as Record<string, unknown>), confirmed_at: new Date().toISOString() }
  const parsed = parseNotionMapping(rawMapping)
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.reason }, { status: 400 })
  }

  const connection = await findNotionConnection(connectionId, orgId)
  if (!connection) {
    return NextResponse.json({ error: 'connection not found' }, { status: 404 })
  }

  const cred = await resolveCredentials(connection)
  if (cred.status !== 'ok') {
    if (cred.status === 'misconfigured') {
      return NextResponse.json({ error: cred.reason }, { status: 422 })
    }
    if (cred.status === 'auth_failed') {
      return NextResponse.json({ error: '接続が失効しています。再接続してください' }, { status: 409 })
    }
    return NextResponse.json(
      { error: '接続先に到達できませんでした。時間をおいて再試行してください' },
      { status: 502 },
    )
  }

  // ⚠ 信頼境界の本丸: クライアント/提案APIの値を信用せず、ここでライブスキーマを再取得して検証する。
  let schema
  try {
    schema = await fetchDatabaseSchema(cred.credentials.token, databaseId)
  } catch (err) {
    const status = (err as { status?: number }).status
    if (status === 401 || status === 403) {
      return NextResponse.json({ error: 'Notionへのアクセス権がありません' }, { status: 400 })
    }
    if (status === 404) {
      return NextResponse.json({ error: 'データベースが見つかりません' }, { status: 404 })
    }
    console.error('[notion-mapping/save] fetchDatabaseSchema failed:', databaseId, messageOf(err))
    return NextResponse.json(
      { error: 'Notion に到達できませんでした。時間をおいて再試行してください' },
      { status: 502 },
    )
  }

  const liveProps = toLiveProperties(schema)
  const validation = validateMappingAgainstSchema(parsed.data, liveProps)
  if (!validation.valid) {
    return NextResponse.json({ error: validation.reason }, { status: 400 })
  }

  // import_config の他キー(target_space_id 等)を保持したまま部分更新する。
  const currentConfig = connection.import_config ?? {}
  const currentMappings = (currentConfig.notion_mappings as Record<string, unknown> | undefined) ?? {}
  const currentContainerIds = Array.isArray(currentConfig.read_container_ids)
    ? currentConfig.read_container_ids.filter((v): v is string => typeof v === 'string')
    : []
  const nextContainerIds = currentContainerIds.includes(databaseId)
    ? currentContainerIds
    : [...currentContainerIds, databaseId]

  const nextConfig: Record<string, unknown> = {
    ...currentConfig,
    notion_mappings: { ...currentMappings, [databaseId]: parsed.data },
    read_container_ids: nextContainerIds,
  }

  const admin = createAdminClient()
  const { data: updated, error: updateError } = await admin
    .from('integration_connections')
    .update({ import_config: nextConfig })
    .eq('id', connectionId)
    .eq('org_id', orgId)
    .select('id, import_config')
    .maybeSingle()

  if (updateError || !updated) {
    console.error('[notion-mapping/save] update failed:', connectionId, updateError?.message)
    return NextResponse.json({ error: 'マッピングの保存に失敗しました' }, { status: 500 })
  }

  return NextResponse.json({ database_id: databaseId, mapping: parsed.data })
}
