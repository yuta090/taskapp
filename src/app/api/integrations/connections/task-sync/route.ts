import { NextRequest, NextResponse } from 'next/server'
import { requireOrgAdmin } from '@/lib/channels/authz'
import { isValidUuid } from '@/lib/uuid'
import { validateWebhookUrl } from '@/lib/sinks/ssrf'
import { createAdminClient } from '@/lib/supabase/admin'
import { encryptToken } from '@/lib/integrations/token-crypto'
import { getTaskSyncAdapter } from '@/lib/task-sync/adapters'
import { assertAllowedHost } from '@/lib/task-sync/hostPolicy'
import { deriveExternalAccountKey } from '@/lib/task-sync/accountKey'
import { validateKintoneAppCredentials } from '@/lib/task-sync/providers/kintone/appCredentials'

export const runtime = 'nodejs'

/**
 * POST /api/integrations/connections/task-sync — APIキー方式のタスク同期接続を作成する。
 *
 * 「顧客が既に使っているタスク管理へ最短で繋ぐ」ための入口。OAuth 審査を待たずに運用者が自分で
 * 発行できる APIキー/PAT を受け取る形にしてある。
 *
 * ここが担う3つの境界:
 *   1. 認可 — owner/admin のみ（接続は組織資産であり、鍵を預かる操作だから）。
 *   2. 接続先の検証 — アダプタが宣言する hostPolicy に従う。any-https（Redmine のような自ホスト）
 *      だけは許可リストで守れないため、DNS解決結果のIP検査（validateWebhookUrl）を通す。
 *      ⚠ この検証は「作成時」であり、実行時の検証はアダプタ側にもある（DNSは後から向け直せるため、
 *      作成時の検証だけでは不十分。両方が要る）。
 *   3. 鍵の検証 — 保存前に実際に外部APIを1回叩く。間違った鍵を保存すると、以後の取り込みが毎回
 *      失敗し、運用者は「繋がらない理由」を知る手段がない。作成時に落として原因を返す方が親切。
 *
 * 鍵は既存の token-crypto で暗号化して access_token_encrypted に入れる（OAuth と同じ列。
 * 「APIに提示するシークレット」という意味論が同じで、寿命管理の差は auth_kind で表すため）。
 */

interface CreateBody {
  org_id?: unknown
  provider?: unknown
  api_key?: unknown
  base_url?: unknown
  /**
   * ツール固有の追加設定（例: Jira の Basic 認証に要るメールアドレス `jira_email`）。
   * 秘密ではない可視の値だけを受ける（秘密は api_key の1本に集約する）。
   */
  provider_config?: unknown
}

/**
 * provider 固有設定のうち、**そのツールの接頭辞が付いたキーだけ**を採る。
 *
 * import_config は全ツール共通の袋であり、他ツールの設定が混ざると
 * 「なぜかBacklogの設定でJiraの挙動が変わる」類の追跡困難な事故になる。値は文字列/数値/真偽/
 * 文字列配列のみ許可する（任意のオブジェクトを通すと、後段のDB検証トリガーが見ていない構造が
 * 紛れ込む）。
 */
function sanitizeProviderConfig(raw: unknown, provider: string): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!key.startsWith(`${provider}_`)) continue
    const isScalar = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    const isStringArray = Array.isArray(value) && value.every((v) => typeof v === 'string' || typeof v === 'number')
    if (isScalar || isStringArray) out[key] = value
  }
  return out
}

/**
 * 受け付けるボディの上限。org_id/provider/api_key/base_url程度に加え、provider_config
 * （ツール固有の可視設定。kintoneなら複数アプリID等）を含めても十分な余裕を持たせつつ、
 * 巨大なペイロードでDB/ログに想定外の値を流し込まれないようにする（kintone/apps/route.ts の
 * 8KB上限と同じ考え方。こちらは provider_config 分だけ少し広めに取る）。
 */
const MAX_BODY_BYTES = 16 * 1024

type ReadJsonBodyResult =
  | { ok: true; body: CreateBody }
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
  return { ok: true, body: parsed as CreateBody }
}

export async function POST(request: NextRequest) {
  const parsedBody = await readJsonBody(request)
  if (!parsedBody.ok) {
    return NextResponse.json({ error: parsedBody.error }, { status: parsedBody.status })
  }
  const body = parsedBody.body

  const orgId = typeof body.org_id === 'string' ? body.org_id : ''
  if (!isValidUuid(orgId)) {
    return NextResponse.json({ error: 'org_id is required' }, { status: 400 })
  }

  const auth = await requireOrgAdmin(orgId)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const provider = typeof body.provider === 'string' ? body.provider : ''
  const adapter = getTaskSyncAdapter(provider)
  if (!adapter) {
    // DB の provider 列は形式チェックのみなので、値の妥当性はこの登録表が唯一の門番になる。
    return NextResponse.json({ error: 'このツールはまだ対応していません' }, { status: 400 })
  }
  if (adapter.authKind !== 'api_key') {
    // OAuth のツールは同意画面を通る別経路（/api/integrations/auth/[provider]）。
    return NextResponse.json({ error: 'このツールはAPIキーでは接続できません' }, { status: 400 })
  }

  const apiKey = typeof body.api_key === 'string' ? body.api_key.trim() : ''
  if (!apiKey) {
    return NextResponse.json({ error: 'APIキーを入力してください' }, { status: 400 })
  }

  const rawBaseUrl = typeof body.base_url === 'string' ? body.base_url.trim() : ''
  const needsBaseUrl = adapter.hostPolicy.kind !== 'fixed'
  if (needsBaseUrl && !rawBaseUrl) {
    return NextResponse.json({ error: '接続先URLを入力してください' }, { status: 400 })
  }

  let baseUrl: string | null = null
  if (needsBaseUrl) {
    try {
      // 形式・スキーム・ドメイン境界の検証（アダプタ宣言に従う）。
      baseUrl = assertAllowedHost(adapter.hostPolicy, rawBaseUrl, provider).origin
    } catch (err) {
      return NextResponse.json({ error: messageOf(err) }, { status: 400 })
    }
    if (adapter.hostPolicy.kind === 'any-https') {
      // 任意ホストは許可リストで守れない。実IPを解決して内部アドレスを弾く。
      const ssrf = await validateWebhookUrl(baseUrl)
      if (!ssrf.ok) {
        return NextResponse.json({ error: `接続先URLが使用できません: ${ssrf.reason}` }, { status: 400 })
      }
    }
  }

  let providerConfig = sanitizeProviderConfig(body.provider_config, provider)

  // kintone: アプリID一覧(kintone_app_ids)とAPIキー(カンマ結合トークン)の対応づけを、接続作成の
  // 時点で厳格に検証する。
  //
  // ⚠ 経緯（Codexレビュー指摘・Critical「正本を欠いた接続を成功扱いにできる」）: 以前は
  // アプリIDが1件以上あることだけを確認し、トークン数との不一致は kintone_app_tokens（後続の
  // アプリ追加/削除が依存する正本）の書き込みだけを諦めて**接続自体は201で成功させていた**。
  // これは kintone_app_ids と access_token_encrypted(カンマ結合)はあるのに正本(kintone_app_tokens)
  // が無い「死んだ接続」そのものであり、以後のアプリ追加/削除が KTGAP で恒久停止し、
  // どのトークンがどのアプリのものか復元不能になる。以後は不一致・不正な形式・重複・上限超過を
  // 接続作成そのものの拒否理由にする（このアダプタが依存する「apiKey(カンマ結合)と
  // kintone_app_idsが同じ1リクエスト内で同じ行配列から同時に組み立てられた」という契約は、
  // この検証を通ったときだけ信用してよい）。
  //
  // 保存する kintone_app_ids は必ずこの検証・正規化後の配列に置き換える（生の providerConfig を
  // そのまま保存しない。form側の入力ゆらぎ・重複がそのままDBへ残るのを防ぐ）。
  let kintoneCredentials: { appIds: string[]; tokens: string[] } | undefined
  if (provider === 'kintone') {
    const validated = validateKintoneAppCredentials(providerConfig.kintone_app_ids, apiKey)
    if (!validated.ok) {
      return NextResponse.json({ error: validated.reason }, { status: 400 })
    }
    kintoneCredentials = { appIds: validated.appIds, tokens: validated.tokens }
    providerConfig = { ...providerConfig, kintone_app_ids: validated.appIds }
  }

  // 保存前に鍵を検証する（間違った鍵を保存させない）。provider固有設定も一緒に渡す
  // （Jira の Basic 認証はメールアドレスが揃って初めて成立するため、設定込みで検証しないと
  // 「保存はできたが一度も同期できない」接続ができてしまう）。
  try {
    await adapter.listContainers({
      credentials: { kind: 'api_key', token: apiKey, baseUrl },
      config: providerConfig,
    })
  } catch (err) {
    const status = (err as { status?: number }).status
    if (status === 401 || status === 403) {
      return NextResponse.json({ error: 'APIキーが正しくないか、権限が足りません' }, { status: 400 })
    }
    if (status === 404) {
      return NextResponse.json({ error: '接続先が見つかりません。URLを確認してください' }, { status: 400 })
    }
    // 相手側の一時障害。運用者の設定は正しいかもしれないので、その旨を返す（保存はしない）。
    console.error('[task-sync/connect] verification failed:', provider, status ?? 'no-status')
    return NextResponse.json(
      { error: '接続先に到達できませんでした。時間をおいて再試行してください' },
      { status: 502 },
    )
  }

  // kintone: kintone_app_tokens(app_id→個別暗号化トークンのjsonbオブジェクト)を接続作成時にも
  // 一緒に書き込む。「どのトークンがどのアプリのものか」の正本はkintone_app_tokensであり
  // (20260723014852_kintone_apps_merge_rpc.sql冒頭コメント参照)、後続のアプリ追加/削除
  // (kintone/apps/route.ts)がこれに依存する。上の validateKintoneAppCredentials を通っているため
  // appIds と tokens は既に同じ長さ・同じ順序であることが保証されている（位置対応の組み立てに
  // 推測は要らない）。
  let kintoneAppTokens: Record<string, string> | undefined
  if (kintoneCredentials) {
    kintoneAppTokens = {}
    for (let i = 0; i < kintoneCredentials.appIds.length; i++) {
      kintoneAppTokens[kintoneCredentials.appIds[i]] = await encryptToken(kintoneCredentials.tokens[i])
    }
  }

  const encrypted = await encryptToken(apiKey)
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('integration_connections')
    .insert({
      provider,
      owner_type: 'org',
      owner_id: orgId,
      org_id: orgId,
      // access_token は既存の NOT NULL 制約を持つ。実体は暗号化列にあるため空文字で満たす
      // （平文列に鍵を残さない）。
      access_token: '',
      access_token_encrypted: encrypted,
      auth_kind: 'api_key',
      base_url: baseUrl,
      external_account_key: deriveExternalAccountKey(adapter, baseUrl),
      status: 'active',
      // 取り込みは既定で無効。取り込み先スペースを選ぶまで動かさない（設定前に大量のタスクが
      // 予期しないスペースへ流れ込むのを防ぐ）。
      import_enabled: false,
      // ツール固有設定は import_config に同居させる（取り込み先スペース等と同じ袋）。
      // 接頭辞で名前空間を分けているので他ツールの設定と衝突しない。
      import_config: {
        ...providerConfig,
        ...(kintoneAppTokens ? { kintone_app_tokens: kintoneAppTokens } : {}),
      },
    })
    .select('id')
    .single()

  if (error || !data) {
    if ((error as { code?: string } | null)?.code === '23505') {
      return NextResponse.json(
        { error: 'この接続先には既に繋がっています（同じ接続を二重に作ることはできません）' },
        { status: 409 },
      )
    }
    console.error('[task-sync/connect] insert failed:', (error as { message?: string } | null)?.message)
    return NextResponse.json({ error: '接続の作成に失敗しました' }, { status: 500 })
  }

  return NextResponse.json({ connection_id: (data as { id: string }).id, provider }, { status: 201 })
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : '接続先URLが不正です'
}
