import { NextRequest, NextResponse } from 'next/server'
import { requireOrgAdmin } from '@/lib/channels/authz'
import { isValidUuid } from '@/lib/uuid'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCredentials, type ConnectionCredentialRow } from '@/lib/task-sync/credentials'
import { fetchAppFields } from '@/lib/task-sync/providers/kintone/schema'
import {
  parseKintoneMapping,
  validateMappingAgainstSchema,
  isValidKintoneAppId,
  normalizeKintoneAppIds,
} from '@/lib/task-sync/providers/kintone/mapping'

export const runtime = 'nodejs'

/**
 * PUT /api/integrations/connections/kintone/mapping
 *
 * 「AI提案＋人が1回確認」方式（notion/mapping/route.ts と同じ設計。変更しない）のうち、
 * 確認・確定を保存する側。
 *
 * ⚠ 最重要の信頼境界: クライアントが送ってきた mapping も、提案API(propose)が返した提案も
 * 一切信用しない。ここで**サーバ側がライブのフィールド定義を再取得**し、
 * validateMappingAgainstSchema を通した結果だけを保存する。検証は必ずこの1箇所（保存の直前）で
 * 行う。
 *
 * confirmed_at は常にサーバ側の現在時刻を入れる（クライアント指定値は採用しない。タイムスタンプ
 * なので toISOString() を使ってよい — CLAUDE.md の禁止はローカル日付の生成/表示についてであり、
 * 監査用タイムスタンプには適用されない。notion/mapping/route.ts と同じ扱い）。
 *
 * ⚠ 取り込み対象の正本(fable裁定 2026-07-22): kintone では kintone_app_ids が取り込み対象の
 * 正本とする(各アプリはトークンとセットでしか登録できないため。下の「app_idが未登録なら拒否」の
 * コメント参照)。アダプタの listContainers はここから対象を導出している。したがって
 * **この保存APIは read_container_ids を一切触らない**（Notion と違い、保存時に自動追記する
 * 対象が無い。engineは read_container_ids が空ならkintone_app_ids由来の全コンテナを対象にする
 * ため整合する）。
 * ⚠ ただし汎用PATCH(import-config/route.ts)等で kintone 接続に read_container_ids が
 * 明示的に設定された場合は、そちらが絞り込みとして別途効く(二重性)。将来ウィザードUIを作る際に
 * この二重性を踏まないよう、既知の挙動としてここに明記しておく。
 *
 * ⚠ 保存は RPC(rpc_kintone_mapping_merge)で原子的に行う（read-modify-write にしない。
 * last-writer-wins を避ける理由は notion_mapping_merge_rpc.sql と同じ）。RPCがマージするのは
 * kintone_mappings[app_id] のみで良い(上記の通り read_container_ids は触らないため)。
 */

interface PutBody {
  org_id?: unknown
  connection_id?: unknown
  app_id?: unknown
  mapping?: unknown
}

interface KintoneConnectionRow extends ConnectionCredentialRow {
  org_id: string
  provider: string
  import_config: Record<string, unknown> | null
}

/** connection_id を org_id・provider='kintone' の境界付きで引く。他orgの接続は絶対に引けない。 */
async function findKintoneConnection(connectionId: string, orgId: string): Promise<KintoneConnectionRow | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('integration_connections')
    .select(
      'id, org_id, provider, auth_kind, base_url, access_token_encrypted, refresh_token_encrypted, refresh_token, import_config',
    )
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

/**
 * 受け付けるボディの上限。org_id/connection_id/app_id/mapping程度の小さなJSONで十分
 * （mappingにstatusサブオブジェクトが乗っても数百バイト〜数KBに収まる。notion/mapping/route.ts
 * と同じ様式）。
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
  const appId = typeof body.app_id === 'string' ? body.app_id.trim() : ''

  if (!isValidUuid(orgId)) {
    return NextResponse.json({ error: 'org_id is required' }, { status: 400 })
  }
  if (!isValidUuid(connectionId)) {
    return NextResponse.json({ error: 'connection_id is required' }, { status: 400 })
  }
  if (!appId || !isValidKintoneAppId(appId)) {
    // 形式外の巨大な文字列がURL構築(fetchAppFields)・外部呼び出し・ログに流れるのを防ぐ。
    return NextResponse.json({ error: 'app_id must be a valid kintone app id (numeric)' }, { status: 400 })
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
  const parsed = parseKintoneMapping(rawMapping)
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.reason }, { status: 400 })
  }

  const connection = await findKintoneConnection(connectionId, orgId)
  if (!connection) {
    return NextResponse.json({ error: 'connection not found' }, { status: 404 })
  }

  // ⚠ 「死んだマッピング」の防止(fable裁定 2026-07-22): kintone_app_ids に登録されていない
  // app_id は保存自体を拒否する(自動追加はしない)。理由は propose/route.ts の同名コメントと
  // 同じ: kintoneのAPIトークンはアプリ単位で発行され、この保存API自身は「まだ登録されていない
  // アプリのトークン」を持たない・作れない。Notionのように保存確定時に自動でコンテナ一覧へ
  // 追記する(read_container_ids)ことができないため、「先にアプリ(IDとトークン)を接続に登録する
  // (task-sync/route.ts) → その後マッピングを確定する」という順序を構造的に強制する。
  // 許してしまうと、保存はできるのにkintone_app_idsに無いため永久にポーリング対象へ
  // ならない「死んだマッピング」を作れてしまう(kintoneを非公開に留めていた理由と同種の問題)。
  const configuredAppIds = normalizeKintoneAppIds(connection.import_config?.kintone_app_ids)
  if (!configuredAppIds.includes(appId)) {
    return NextResponse.json(
      { error: 'このアプリは接続に登録されていません。先にアプリIDとAPIトークンを追加してください' },
      { status: 400 },
    )
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

  // ⚠ 信頼境界の本丸: クライアント/提案APIの値を信用せず、ここでライブのフィールド定義を
  // 再取得して検証する。
  let fields
  try {
    fields = await fetchAppFields(cred.credentials.baseUrl, cred.credentials.token, appId)
  } catch (err) {
    const status = (err as { status?: number }).status
    const permanent = (err as { permanent?: boolean }).permanent
    if (status === 404) {
      return NextResponse.json({ error: 'アプリが見つかりません' }, { status: 404 })
    }
    if (permanent) {
      // 設定不備。kintoneFetch(client.ts)が既に運用者向けの具体的な日本語メッセージ
      // (トークン未反映/権限不足/アプリ不一致など)を組み立てているため、そのまま返す
      // (秘密情報は含まれない。client.tsのthrowForFailedResponse参照)。
      // ⚠ 意図的にNotionの「401→409再接続導線」とは揃えない(fable裁定 2026-07-22): それは
      // OAuthのrefreshで直る場合の分岐であり、APIキー方式のkintoneには当てはまらない。
      // client.tsのGAIA_*判定による具体的な案内をそのまま透過するほうが正しい。
      return NextResponse.json({ error: messageOf(err) }, { status: 400 })
    }
    console.error('[kintone-mapping/save] fetchAppFields failed:', appId, messageOf(err))
    return NextResponse.json(
      { error: 'kintoneに到達できませんでした。時間をおいて再試行してください' },
      { status: 502 },
    )
  }

  const validation = validateMappingAgainstSchema(parsed.data, fields)
  if (!validation.valid) {
    return NextResponse.json({ error: validation.reason }, { status: 400 })
  }

  // 保存はRPCで原子的に行う(read-modify-writeのlast-writer-winsを避ける。ファイル冒頭コメント参照)。
  // kintone_mappings[app_id] の更新をRPC内の単一UPDATE文で行う。ここでは import_config 全体を
  // 組み立てない（＝他アプリのkintone_mappingsエントリを一切送らない。他のキー(kintone_app_ids等)
  // もRPC側で保持される）。
  const admin = createAdminClient()
  const { data: mergedConfig, error: rpcError } = await admin.rpc('rpc_kintone_mapping_merge', {
    p_connection_id: connectionId,
    p_org_id: orgId,
    p_app_id: appId,
    p_mapping: parsed.data,
  })

  if (rpcError || !mergedConfig) {
    console.error('[kintone-mapping/save] rpc_kintone_mapping_merge failed:', connectionId, rpcError?.message)
    // 22023 は RPC 側が「既存の import_config の型が壊れている」と判断したときだけ付ける
    // SQLSTATE。再試行しても直らない状態なので 5xx（＝あとで再試行せよ）にはしない。
    // DB の内部文言はそのまま返さず、運用者が次に取るべき行動が分かる文言に置き換える。
    if ((rpcError as { code?: string } | null)?.code === '22023') {
      return NextResponse.json(
        { error: 'この接続の取り込み設定が壊れています。設定を作り直してください' },
        { status: 422 },
      )
    }
    return NextResponse.json({ error: 'マッピングの保存に失敗しました' }, { status: 500 })
  }

  return NextResponse.json({ app_id: appId, mapping: parsed.data })
}
