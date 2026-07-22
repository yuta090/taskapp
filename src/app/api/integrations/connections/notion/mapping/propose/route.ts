import { NextRequest, NextResponse } from 'next/server'
import { requireOrgAdmin } from '@/lib/channels/authz'
import { isValidUuid } from '@/lib/uuid'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCredentials, type ConnectionCredentialRow } from '@/lib/task-sync/credentials'
import { fetchDatabaseSchema, proposeMapping } from '@/lib/task-sync/providers/notion/schema'
import { refineProposalWithAi, sanitizeProposalAgainstSchema, toLiveProperties } from '@/lib/task-sync/providers/notion/mappingWizard'
import { isValidNotionDatabaseId } from '@/lib/task-sync/providers/notion/mapping'

export const runtime = 'nodejs'

/**
 * POST /api/integrations/connections/notion/mapping/propose
 *
 * 「AI提案＋人が1回確認」方式（設計確定済み・変更しない）のうち、提案を作る側。
 *   1. ライブスキーマを取得（レコード値は取得しない）
 *   2. 決定的ヒューリスティックで「たたき台」を作る（proposeMapping・LLM不使用・テスト容易性優先）
 *   3. LLMでたたき台を精緻化する（プロパティのメタデータのみを渡す。AI呼び出しの失敗・出力不正は
 *      ヒューリスティックへフォールバックし、ハードエラーにしない — ユーザーは手動選択で進めるため）
 *   4. 返す直前に必ずライブスキーマへ再度突き合わせ、無効な部分はnullに落とす（最終防衛線）
 *
 * confirmed_at はここでは含めない（確認は保存API側で起きる）。
 *
 * ⚠ このルート専用のレート制限は**意図的に置かない**（判断を記録する。後から「抜けている」と
 * 誤解されないため）。LLM費用の歯止めは callLlm(src/lib/ai/client.ts)側の org 単位の月次コスト
 * 上限とプール上限が backstop として効いており、そこを唯一の予算境界に保つほうが、境界を
 * 2箇所に分散させるより漏れが少ない。呼び出し自体も owner/admin 限定・1回の確認導線でしか
 * 使わないため、ここに独自の回数制限を足す価値より、境界が二重化する保守コストが上回ると判断した。
 * 実測でこのルートが費用の主因になったら、汎用のレート制限層として（このルート限定ではなく）
 * 入れ直すこと。
 */

interface ProposeBody {
  org_id?: unknown
  connection_id?: unknown
  database_id?: unknown
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
    .select('id, org_id, provider, auth_kind, base_url, access_token_encrypted, refresh_token_encrypted, refresh_token')
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
 * 受け付けるボディの上限。org_id/connection_id/database_id程度の小さなJSONで十分。
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

export async function POST(request: NextRequest) {
  const parsedBody = await readJsonBody(request)
  if (!parsedBody.ok) {
    return NextResponse.json({ error: parsedBody.error }, { status: parsedBody.status })
  }
  const body = parsedBody.body as ProposeBody

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
    // transient_error
    return NextResponse.json(
      { error: '接続先に到達できませんでした。時間をおいて再試行してください' },
      { status: 502 },
    )
  }

  let schema
  try {
    schema = await fetchDatabaseSchema(cred.credentials.token, databaseId)
  } catch (err) {
    const status = (err as { status?: number }).status
    if (status === 401) {
      // 401はトークンそのものが失効/無効（403=トークンは有効だがそのDBが共有されていない、
      // とは原因も対処も違う）。ここを403と同じ「アクセス権がありません」にすると、
      // 利用者は再接続すべき場面でNotion側のDB共有をやり直そうとして解決しない。
      // 保存API・resolveCredentialsのauth_failedと同じ409+再接続導線に揃える。
      return NextResponse.json({ error: '接続が失効しています。再接続してください' }, { status: 409 })
    }
    if (status === 403) {
      return NextResponse.json({ error: 'Notionへのアクセス権がありません' }, { status: 400 })
    }
    if (status === 404) {
      return NextResponse.json({ error: 'データベースが見つかりません' }, { status: 404 })
    }
    console.error('[notion-mapping/propose] fetchDatabaseSchema failed:', databaseId, messageOf(err))
    return NextResponse.json(
      { error: 'Notion に到達できませんでした。時間をおいて再試行してください' },
      { status: 502 },
    )
  }

  const heuristic = proposeMapping(schema)
  const refined = await refineProposalWithAi({
    orgId,
    schema,
    heuristic: { due_prop_id: heuristic.due_prop_id, status: heuristic.status },
  })

  const liveProps = toLiveProperties(schema)
  const sanitized = sanitizeProposalAgainstSchema(
    { due_prop_id: refined.due_prop_id, status: refined.status },
    liveProps,
  )

  return NextResponse.json({
    schema,
    proposal: sanitized,
    proposal_source: refined.source,
    ...(refined.aiUnavailableReason ? { ai_unavailable_reason: refined.aiUnavailableReason } : {}),
  })
}
