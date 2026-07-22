import { NextRequest, NextResponse } from 'next/server'
import { requireOrgAdmin } from '@/lib/channels/authz'
import { isValidUuid } from '@/lib/uuid'
import { createAdminClient } from '@/lib/supabase/admin'
import { getEncryptionKey } from '@/lib/integrations/token-crypto'
import { fetchAppFields } from '@/lib/task-sync/providers/kintone/schema'
import { MAX_API_TOKENS_PER_REQUEST } from '@/lib/task-sync/providers/kintone/client'
import { isValidKintoneAppId, normalizeKintoneAppIds } from '@/lib/task-sync/providers/kintone/mapping'
import { validateKintoneApiToken } from '@/lib/task-sync/providers/kintone/appCredentials'

export const runtime = 'nodejs'

/**
 * POST/DELETE /api/integrations/connections/kintone/apps — 接続後にアプリを増減する専用経路。
 *
 * kintone のAPIトークンはアプリ単位でしか発行できず、`kintone_app_ids`（取り込み対象の正本。
 * kintone/mapping/route.ts 冒頭コメント参照）はサーバ管理フィールドのため汎用の import-config
 * PATCH では変更できない。「アプリを1つ追加/削除する」ためのこの専用経路が要る。
 *
 * ⚠ トークンとアプリの対応の保持方式（実装ランナーへの委任事項への回答）:
 * `import_config.kintone_app_tokens`（app_id をキーにした、アプリ単位で個別に暗号化した
 * トークンの jsonb オブジェクト）を「どのトークンがどのアプリのものか」の唯一の正本とする。
 * 実際に kintone へ送るヘッダ値（カンマ結合の複合blob。access_token_encrypted）はここから
 * 都度再計算する派生キャッシュとし、DB側の RPC（rpc_kintone_apps_add/remove。
 * 20260723014852_kintone_apps_merge_rpc.sql）が行ロックの内側で復号→結合→再暗号化まで
 * 一括して行う（Node側で読み書きを分けない。読みと書きの間に別の追加/削除が挟まる競合を
 * 構造的に防ぐため）。暗号鍵(SYSTEM_ENCRYPTION_KEY)はDBに保存されないため、この route が
 * 毎回引数として渡す（token-crypto.ts の encryptToken/decryptToken と同じ設計）。
 *
 * ⚠ 判断（実装ランナーへの委任事項への回答。理由を明記のうえ実装する）:
 *   1. 既に登録済みの app_id を再度追加しようとしたら 409 で拒否する（トークンの入れ替えは
 *      許さない）。トークンをローテーションしたい場合は「削除してから追加」の2手順に委ねる。
 *      この関数は「新規追加」だけに責務を絞ることで、同じapp_idを2回押したときの挙動を
 *      予測しやすくする（暗黙のローテーションによる事故を避ける）。
 *   2. アプリ削除時、`kintone_mappings[app_id]` は削除しない（残す）。Notion（取り込み対象から
 *      外しても確定済みマッピングは残る）と同じ挙動に揃える。再度同じ app_id を追加すれば
 *      以前のマッピングがそのまま有効になる。
 *
 * 認可: requireOrgAdmin（owner/adminのみ）＋接続の org・provider='kintone' 一致。
 * 秘密（APIトークン・暗号化blob・暗号鍵）は応答・ログに一切出さない。
 */

interface KintoneConnectionRow {
  id: string
  org_id: string
  provider: string
  base_url: string | null
  import_config: Record<string, unknown> | null
}

/** connection_id を org_id・provider='kintone' の境界付きで引く。他orgの接続は絶対に引けない。 */
async function findKintoneConnection(connectionId: string, orgId: string): Promise<KintoneConnectionRow | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('integration_connections')
    .select('id, org_id, provider, base_url, import_config')
    .eq('id', connectionId)
    .eq('org_id', orgId)
    .eq('provider', 'kintone')
    .maybeSingle()
  if (error || !data) return null
  return data as KintoneConnectionRow
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** 受け付けるボディの上限（org_id/connection_id/app_id/api_token程度の小さなJSONで十分）。 */
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
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, status: 400, error: 'body must be a JSON object' }
  }
  return { ok: true, body: parsed as Record<string, unknown> }
}

interface CommonFields {
  orgId: string
  connectionId: string
  appId: string
}

/** org_id/connection_id/app_id の共通検証。返り値がnullなら呼び出し側は既にレスポンスを返している。 */
function parseCommonFields(body: Record<string, unknown>): CommonFields | NextResponse {
  const orgId = typeof body.org_id === 'string' ? body.org_id : ''
  const connectionId = typeof body.connection_id === 'string' ? body.connection_id : ''
  const appId = typeof body.app_id === 'string' ? body.app_id.trim() : ''

  if (!isValidUuid(orgId)) {
    return NextResponse.json({ error: 'org_id is required' }, { status: 400 })
  }
  if (!isValidUuid(connectionId)) {
    return NextResponse.json({ error: 'connection_id is required' }, { status: 400 })
  }
  if (!appId || !isValidKintoneAppId(appId)) {
    return NextResponse.json({ error: 'app_id must be a valid kintone app id (numeric)' }, { status: 400 })
  }
  return { orgId, connectionId, appId }
}

function isNextResponse(value: unknown): value is NextResponse {
  return value instanceof NextResponse
}

export async function POST(request: NextRequest) {
  const parsedBody = await readJsonBody(request)
  if (!parsedBody.ok) {
    return NextResponse.json({ error: parsedBody.error }, { status: parsedBody.status })
  }
  const body = parsedBody.body

  const common = parseCommonFields(body)
  if (isNextResponse(common)) return common
  const { orgId, connectionId, appId } = common

  const apiToken = typeof body.api_token === 'string' ? body.api_token.trim() : ''
  // 接続作成時(validateKintoneAppCredentials)と同じ形式検証(長さ上限・制御文字)を、単一トークン
  // 追加のこの経路にも適用する(以前はここに上限が無く、ボディサイズ上限(8KB)で間接的に縛られて
  // いるだけだった非対称の是正。二重定義を避けappCredentials.tsの共通関数を再利用する)。
  const tokenCheck = validateKintoneApiToken(apiToken)
  if (!tokenCheck.ok) {
    return NextResponse.json({ error: tokenCheck.reason }, { status: 400 })
  }

  const auth = await requireOrgAdmin(orgId)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const connection = await findKintoneConnection(connectionId, orgId)
  if (!connection) {
    return NextResponse.json({ error: 'connection not found' }, { status: 404 })
  }

  // 事前チェック(外部API呼び出し・DB書き込みの前に安く弾く。行ロック後の再確認はRPC側で行う)。
  const configuredAppIds = normalizeKintoneAppIds(connection.import_config?.kintone_app_ids)
  if (configuredAppIds.includes(appId)) {
    // 判断(冒頭コメント参照): 既存app_idの再追加は409で拒否する(トークンの入れ替えは許さない)。
    return NextResponse.json({ error: 'このアプリは既に登録されています' }, { status: 409 })
  }
  if (configuredAppIds.length >= MAX_API_TOKENS_PER_REQUEST) {
    return NextResponse.json(
      { error: `kintoneのAPIトークンは1接続につき最大${MAX_API_TOKENS_PER_REQUEST}個までです` },
      { status: 400 },
    )
  }

  // 追加前に必ず疎通確認する(間違ったトークンを保存させない。task-sync/route.tsの接続作成時
  // 検証・kintone/mapping/{propose,route}.tsのfetchAppFields呼び出しと同じ姿勢)。
  try {
    await fetchAppFields(connection.base_url, apiToken, appId)
  } catch (err) {
    const status = (err as { status?: number }).status
    const permanent = (err as { permanent?: boolean }).permanent
    if (status === 404) {
      return NextResponse.json({ error: 'アプリが見つかりません' }, { status: 404 })
    }
    if (permanent) {
      // client.ts の throwForFailedResponse が既に運用者向けの具体的な日本語メッセージ
      // (トークン未反映/権限不足/アプリ不一致など)を組み立てているため、そのまま返す。
      return NextResponse.json({ error: messageOf(err) }, { status: 400 })
    }
    console.error('[kintone/apps] fetchAppFields failed:', appId, messageOf(err))
    return NextResponse.json(
      { error: 'kintoneに到達できませんでした。時間をおいて再試行してください' },
      { status: 502 },
    )
  }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('rpc_kintone_apps_add', {
    p_connection_id: connectionId,
    p_org_id: orgId,
    p_app_id: appId,
    p_new_token_plaintext: apiToken,
    p_encryption_secret: getEncryptionKey(),
  })

  if (error || !data) {
    const code = (error as { code?: string } | null)?.code
    console.error('[kintone/apps] rpc_kintone_apps_add failed:', connectionId, code)
    if (code === 'KTDUP') {
      return NextResponse.json({ error: 'このアプリは既に登録されています' }, { status: 409 })
    }
    if (code === 'KT9MX') {
      return NextResponse.json(
        { error: `kintoneのAPIトークンは1接続につき最大${MAX_API_TOKENS_PER_REQUEST}個までです` },
        { status: 400 },
      )
    }
    if (code === 'KTGAP') {
      return NextResponse.json(
        { error: 'この接続のトークン対応が壊れています。接続を作り直してください' },
        { status: 422 },
      )
    }
    if (code === '22023') {
      return NextResponse.json(
        { error: 'この接続の取り込み設定が壊れています。設定を作り直してください' },
        { status: 422 },
      )
    }
    return NextResponse.json({ error: 'アプリの追加に失敗しました' }, { status: 500 })
  }

  return NextResponse.json({ app_ids: (data as { app_ids: string[] }).app_ids })
}

export async function DELETE(request: NextRequest) {
  const parsedBody = await readJsonBody(request)
  if (!parsedBody.ok) {
    return NextResponse.json({ error: parsedBody.error }, { status: parsedBody.status })
  }
  const body = parsedBody.body

  const common = parseCommonFields(body)
  if (isNextResponse(common)) return common
  const { orgId, connectionId, appId } = common

  const auth = await requireOrgAdmin(orgId)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const connection = await findKintoneConnection(connectionId, orgId)
  if (!connection) {
    return NextResponse.json({ error: 'connection not found' }, { status: 404 })
  }

  const configuredAppIds = normalizeKintoneAppIds(connection.import_config?.kintone_app_ids)
  if (!configuredAppIds.includes(appId)) {
    return NextResponse.json({ error: 'このアプリは登録されていません' }, { status: 404 })
  }
  if (configuredAppIds.length <= 1) {
    // 不変条件: 接続は最低1アプリを持つ(task-sync/route.tsの作成時ゲートと同じ制約を、
    // 接続のライフサイクル全体で維持する)。
    return NextResponse.json(
      { error: '最後の1つのアプリは削除できません(接続自体を削除してください)' },
      { status: 400 },
    )
  }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('rpc_kintone_apps_remove', {
    p_connection_id: connectionId,
    p_org_id: orgId,
    p_app_id: appId,
    p_encryption_secret: getEncryptionKey(),
  })

  if (error || !data) {
    const code = (error as { code?: string } | null)?.code
    console.error('[kintone/apps] rpc_kintone_apps_remove failed:', connectionId, code)
    if (code === 'KTNF') {
      return NextResponse.json({ error: 'このアプリは登録されていません' }, { status: 404 })
    }
    if (code === 'KTLAST') {
      return NextResponse.json(
        { error: '最後の1つのアプリは削除できません(接続自体を削除してください)' },
        { status: 400 },
      )
    }
    if (code === 'KTGAP') {
      return NextResponse.json(
        { error: 'この接続のトークン対応が壊れています。接続を作り直してください' },
        { status: 422 },
      )
    }
    if (code === '22023') {
      return NextResponse.json(
        { error: 'この接続の取り込み設定が壊れています。設定を作り直してください' },
        { status: 422 },
      )
    }
    return NextResponse.json({ error: 'アプリの削除に失敗しました' }, { status: 500 })
  }

  return NextResponse.json({ app_ids: (data as { app_ids: string[] }).app_ids })
}
