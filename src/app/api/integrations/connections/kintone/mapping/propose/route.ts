import { NextRequest, NextResponse } from 'next/server'
import { requireOrgAdmin } from '@/lib/channels/authz'
import { isValidUuid } from '@/lib/uuid'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCredentials, type ConnectionCredentialRow } from '@/lib/task-sync/credentials'
import { fetchAppFields, proposeMapping } from '@/lib/task-sync/providers/kintone/schema'
import { refineProposalWithAi, sanitizeProposalAgainstSchema } from '@/lib/task-sync/providers/kintone/mappingWizard'
import { isValidKintoneAppId, normalizeKintoneAppIds } from '@/lib/task-sync/providers/kintone/mapping'

export const runtime = 'nodejs'

/**
 * POST /api/integrations/connections/kintone/mapping/propose
 *
 * 「AI提案＋人が1回確認」方式（notion/mapping/propose/route.ts と同じ設計。変更しない）のうち、
 * 提案を作る側。
 *   1. app_id が接続に登録済み(kintone_app_ids)か確認する(下記コメント参照。未登録なら外部API・
 *      LLM呼び出し前に400で止める)
 *   2. ライブのフィールド定義を取得（レコード値は取得しない。fetchAppFields はそもそも
 *      レコードを返さないエンドポイントを叩く）
 *   3. 決定的ヒューリスティックで「たたき台」を作る（proposeMapping・LLM不使用・テスト容易性優先）
 *   4. LLMでたたき台を精緻化する（フィールドのメタデータのみを渡す。AI呼び出しの失敗・出力不正は
 *      ヒューリスティックへフォールバックし、ハードエラーにしない — ユーザーは手動選択で進めるため）
 *   5. 返す直前に必ずライブスキーマへ再度突き合わせ、無効な部分はnullに落とす（最終防衛線）
 *
 * confirmed_at はここでは含めない（確認は保存API側で起きる）。
 *
 * ⚠ Notion との違い(1): title_field_code もマッピング必須(kintoneには構造的なtitleが無いため)。
 * write_done_action はこの提案APIでは一切提案しない(常にnull。mappingWizard.tsのコメント参照)。
 *
 * ⚠ Notion との違い(2) — 401/403 を再接続導線(409)に分けない(fable裁定 2026-07-22):
 * Notion の「401→409 再接続導線」は OAuth（refresh token による再接続で直る）だから意味がある
 * 分岐であり、APIキー方式の kintone には当てはまらない(APIキーはユーザーがkintone側で失効させる
 * まで有効で、再接続フローで直る性質のものではない)。client.ts の throwForFailedResponse が
 * 既に `GAIA_*` コードから運用者が次に取るべき行動("アプリを更新してください"等)を組み立てて
 * いるため、それをそのまま透過するほうが利用者に直結する。下の catch 節を参照。
 *
 * ⚠ Notion との違い(3) — app_id は kintone_app_ids に登録済みのものしか受け付けない:
 * 下の findKintoneConnection 呼び出し直後のコメント参照。
 *
 * ⚠ このルート専用のレート制限は**意図的に置かない**（notion/mapping/propose/route.ts と同じ判断。
 * LLM費用の歯止めは callLlm 側の org 単位の月次コスト上限・プール上限を唯一の予算境界とし、
 * 境界を2箇所に分散させない）。
 */

interface ProposeBody {
  org_id?: unknown
  connection_id?: unknown
  app_id?: unknown
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
 * 受け付けるボディの上限。org_id/connection_id/app_id程度の小さなJSONで十分
 * （src/app/api/connectors/generic/events/route.ts・notion/mapping/propose/route.ts と同じ様式）。
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

  const connection = await findKintoneConnection(connectionId, orgId)
  if (!connection) {
    return NextResponse.json({ error: 'connection not found' }, { status: 404 })
  }

  // ⚠ 「死んだマッピング」の防止(fable裁定 2026-07-22): kintone_app_ids に登録されていない
  // app_id は提案自体を拒否する(自動追加はしない)。理由:
  //   kintone のAPIトークンはアプリ単位で発行され、この接続の credentials はその時点で
  //   登録済みのアプリ分のトークンをカンマ結合しただけの不透明な値である(client.ts参照)。
  //   保存/提案API自身は「まだ登録されていないアプリのトークン」を持たない・作れないため、
  //   Notion の read_container_ids のような「マッピング確定時に自動でコンテナを追加する」
  //   ことができない。したがって kintone では「先にアプリ(IDとトークン)を接続に登録する
  //   (task-sync/route.ts の接続編集経路) → その後マッピングを確定する」という順序を
  //   構造的に強制する。ここを許してしまうと、保存はできるのに
  //   kintone_app_ids に無いため永久にポーリング対象へならない「死んだマッピング」を
  //   作れてしまい、kintone を非公開(planned)に留めていた理由(死んだ接続を作らせない)と
  //   同じ問題を再現する。
  // この判定は外部API呼び出し・LLM呼び出しの**前**に行う(未登録アプリに対して
  // 無駄な外部到達・AI課金を発生させないため)。
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
    // transient_error
    return NextResponse.json(
      { error: '接続先に到達できませんでした。時間をおいて再試行してください' },
      { status: 502 },
    )
  }

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
    console.error('[kintone-mapping/propose] fetchAppFields failed:', appId, messageOf(err))
    return NextResponse.json(
      { error: 'kintoneに到達できませんでした。時間をおいて再試行してください' },
      { status: 502 },
    )
  }

  const heuristic = proposeMapping(fields)
  const refined = await refineProposalWithAi({
    orgId,
    fields,
    heuristic: {
      title_field_code: heuristic.title_field_code,
      due_field_code: heuristic.due_field_code,
      status: heuristic.status,
    },
  })

  const sanitized = sanitizeProposalAgainstSchema(
    { title_field_code: refined.title_field_code, due_field_code: refined.due_field_code, status: refined.status },
    fields,
  )

  return NextResponse.json({
    schema: fields,
    proposal: sanitized,
    proposal_source: refined.source,
    ...(refined.aiUnavailableReason ? { ai_unavailable_reason: refined.aiUnavailableReason } : {}),
  })
}
