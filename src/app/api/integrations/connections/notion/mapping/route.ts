import { NextRequest, NextResponse } from 'next/server'
import { requireOrgAdmin } from '@/lib/channels/authz'
import { isValidUuid } from '@/lib/uuid'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCredentials, type ConnectionCredentialRow } from '@/lib/task-sync/credentials'
import { fetchDatabaseSchema } from '@/lib/task-sync/providers/notion/schema'
import {
  parseNotionMapping,
  validateMappingAgainstSchema,
  isValidNotionDatabaseId,
} from '@/lib/task-sync/providers/notion/mapping'
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
 * ⚠ 保存は RPC(rpc_notion_mapping_merge)で原子的に行う。以前は接続行を読み→外部API呼び出しを
 * 挟み→古い import_config を元に全体を置換する read-modify-write だったため、2つのDBの
 * マッピングをほぼ同時に保存すると後勝ちが先勝ちを消してしまっていた(last-writer-wins)。
 * jsonb の該当部分だけをDB側で原子的にマージすることでこれを防ぐ
 * （詳細: supabase/migrations/*_notion_mapping_merge_rpc.sql）。
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
}

/** connection_id を org_id・provider='notion' の境界付きで引く。他orgの接続は絶対に引けない。 */
async function findNotionConnection(connectionId: string, orgId: string): Promise<NotionConnectionRow | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('integration_connections')
    .select(
      'id, org_id, provider, auth_kind, base_url, access_token_encrypted, refresh_token_encrypted, refresh_token',
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

/**
 * 受け付けるボディの上限。org_id/connection_id/database_id/mapping程度の小さなJSONで十分
 * （mappingにstatusサブオブジェクトが乗っても数百バイト〜数KBに収まる）。
 * Content-Length を見た上で、実サイズでも二重に確認する
 * （src/app/api/connectors/generic/events/route.ts と同じ様式）。
 */
const MAX_BODY_BYTES = 8 * 1024

type ReadJsonBodyResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; status: number; error: string }

async function readJsonBody(request: NextRequest): Promise<ReadJsonBodyResult> {
  const declaredLength = Number(request.headers.get('content-length') ?? '')
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return { ok: false, status: 413, error: 'payload too large' }
  }
  const raw = await request.text()
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    return { ok: false, status: 413, error: 'payload too large' }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, status: 400, error: 'Invalid JSON' }
  }
  // 正当なJSONでも `null`/配列/プリミティブだと以降の body.xxx 参照が例外(→500)になる。
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, status: 400, error: 'body must be a JSON object' }
  }
  return { ok: true, body: parsed as Record<string, unknown> }
}

export async function PUT(request: NextRequest) {
  const parsedBody = await readJsonBody(request)
  if (!parsedBody.ok) {
    return NextResponse.json({ error: parsedBody.error }, { status: parsedBody.status })
  }
  const body = parsedBody.body as PutBody

  const orgId = typeof body.org_id === 'string' ? body.org_id : ''
  const connectionId = typeof body.connection_id === 'string' ? body.connection_id : ''
  const databaseId = typeof body.database_id === 'string' ? body.database_id.trim() : ''

  if (!isValidUuid(orgId)) {
    return NextResponse.json({ error: 'org_id is required' }, { status: 400 })
  }
  if (!isValidUuid(connectionId)) {
    return NextResponse.json({ error: 'connection_id is required' }, { status: 400 })
  }
  if (!databaseId || !isValidNotionDatabaseId(databaseId)) {
    // 形式外の巨大な文字列がURL構築(fetchDatabaseSchema)・外部呼び出し・ログに流れるのを防ぐ。
    return NextResponse.json({ error: 'database_id must be a valid Notion database id' }, { status: 400 })
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
    if (status === 401) {
      // 401はトークンそのものが無効/失効している状態（403=トークンは有効だがそのDBへの
      // アクセス権が無い、とは異なる）。resolveCredentialsのauth_failedと同じ409+再接続導線に
      // 揃える（以前は403と同じ400「アクセス権がありません」を返していたが、失効なら
      // 再接続してもらう方が正しい導線になる）。
      return NextResponse.json({ error: '接続が失効しています。再接続してください' }, { status: 409 })
    }
    if (status === 403) {
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

  // 保存はRPCで原子的に行う(read-modify-writeのlast-writer-winsを避ける。ファイル冒頭コメント参照)。
  // notion_mappings[database_id] の更新と read_container_ids への database_id 追加(重複なし)を
  // RPC内の単一UPDATE文にまとめている。ここでは import_config 全体を組み立てない
  // （＝他DBのnotion_mappingsエントリを一切送らない。他のキーもRPC側で保持される）。
  const admin = createAdminClient()
  const { data: mergedConfig, error: rpcError } = await admin.rpc('rpc_notion_mapping_merge', {
    p_connection_id: connectionId,
    p_org_id: orgId,
    p_database_id: databaseId,
    p_mapping: parsed.data,
  })

  if (rpcError || !mergedConfig) {
    console.error('[notion-mapping/save] rpc_notion_mapping_merge failed:', connectionId, rpcError?.message)
    return NextResponse.json({ error: 'マッピングの保存に失敗しました' }, { status: 500 })
  }

  return NextResponse.json({ database_id: databaseId, mapping: parsed.data })
}
