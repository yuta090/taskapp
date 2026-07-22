import { NextRequest, NextResponse } from 'next/server'
import { requireOrgAdmin } from '@/lib/channels/authz'
import { isValidUuid } from '@/lib/uuid'
import { createAdminClient } from '@/lib/supabase/admin'
import { IMPORT_CONFIG_SERVER_MANAGED_KEYS, sanitizeImportConfigForClient } from '@/lib/integrations/importConfig'

export const runtime = 'nodejs'

interface PatchImportConfigBody {
  import_config?: unknown
  /**
   * 取り込みの有効/無効。省略時は変更しない（後方互換）。
   *
   * import_config と同じ PATCH で受けるのは、**2回に分けると片方だけ成功して状態が中途半端に
   * 残る**ため（取り込み先は設定されたのに無効のまま＝永久に同期されない、あるいはその逆で
   * 取り込み先が消えたのに有効のまま）。設定と有効化は1つの意思決定なので1回の更新にする。
   */
  import_enabled?: unknown
}

/** 接続の org_id を引く（認可の対象orgを決めるためだけ。import_config は読まない）。 */
async function findConnectionOrg(id: string): Promise<string | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('integration_connections')
    .select('org_id')
    .eq('id', id)
    .maybeSingle()
  if (error || !data) return null
  return (data as { org_id: string }).org_id
}

/**
 * PATCH /api/integrations/connections/[id]/import-config — owner/adminのみ。
 *
 * import_config( { target_space_id, read_list_ids?, default_assignee_id? } )と、
 * 任意で import_enabled(取り込みの有効/無効)を**同じ更新で**変更する
 * (器は 20260720125427_connector_two_way_sync.sql で追加済み)。
 *
 * ⚠ 更新は RPC(rpc_import_config_merge)で原子的に行う。read-modify-write にしない理由:
 * 「現在値を読む → import_config 全体を組み立てる → 置換」だと、読みと書きの間に
 * マッピング保存RPC(notion/kintone)が走ったとき、**古い mappings を書き戻して確定した
 * ばかりのマッピングを消す**（lost update）。RPCは行ロックの内側で読み書きするためこれが起きない。
 * このルートは import_config 全体を組み立てない（クライアントが指定したキーだけを p_patch で渡す）。
 *
 * 部分更新のセマンティクス:
 *   - 送られたキーだけを更新する。送られなかったキーは現在値のまま残る。
 *   - 値が null のキーは「未設定に戻す」＝DB上からキーを削除する。
 *     (従来の「キーを送らない＝未設定」は、部分更新では「現在値維持」と区別できないため、
 *      未設定は明示的な null で表す契約に変えた。UI側は normalizeImportConfigPatch が変換する。)
 *
 * org境界の検証(target_space_id/default_assignee_idが接続と同じorgを指すか)はDBトリガー
 * (integration_connections_validate_import_config)が担う。トリガー例外はここで捕捉し、
 * ユーザー向けメッセージに変換して422で返す(内部エラーメッセージをそのまま漏らさない)。
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: 'invalid connection id' }, { status: 400 })
  }

  const orgId = await findConnectionOrg(id)
  if (!orgId) {
    return NextResponse.json({ error: 'connection not found' }, { status: 404 })
  }

  const auth = await requireOrgAdmin(orgId)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  let body: PatchImportConfigBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // 正当なJSONでも `null`/配列/プリミティブだと以降の body.import_config 参照が例外(→500)になる。
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: 'body must be a JSON object' }, { status: 400 })
  }

  if (
    typeof body.import_config !== 'object' ||
    body.import_config === null ||
    Array.isArray(body.import_config)
  ) {
    return NextResponse.json({ error: 'import_config must be an object' }, { status: 400 })
  }

  if (body.import_enabled !== undefined && typeof body.import_enabled !== 'boolean') {
    return NextResponse.json({ error: 'import_enabled must be a boolean' }, { status: 400 })
  }

  // サーバ管理フィールド(notion_mappings/kintone_mappings/kintone_app_ids/kintone_app_tokens)は
  // DBへ送らない。400で弾かずに黙って落とすのは、現在値をそのまま送り返す正当な実装の
  // クライアントまで壊してしまうため（なぜ拒否せず無視するのかを明記する。詳しい理由は
  // IMPORT_CONFIG_SERVER_MANAGED_KEYS のコメント参照）。
  // ⚠ 多層防御: 同じキー集合を RPC(rpc_import_config_merge)側でも落とし、さらに DB トリガー
  // (20260722233606_protect_task_sync_mappings.sql で作成し、保護対象キーは
  // 20260723022033_guard_kintone_app_credentials.sql で kintone のアプリ資格情報まで拡張)が
  // service_role 以外からの変更を拒否する。ここで落とすのは「そもそもDBへ送らない」最初の層。
  const patch: Record<string, unknown> = { ...(body.import_config as Record<string, unknown>) }
  for (const key of IMPORT_CONFIG_SERVER_MANAGED_KEYS) delete patch[key]

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('rpc_import_config_merge', {
    p_connection_id: id,
    p_patch: patch,
    // 省略時は null を渡す＝RPC側で「import_enabled は変更しない」に写像される。
    p_import_enabled: typeof body.import_enabled === 'boolean' ? body.import_enabled : null,
  })

  if (error) {
    // DBエラーは SQLSTATE で切り分ける(全DBエラーを恒久422に潰さない。一時障害を誤って
    // 「入力が恒久的に不正」と誤認させないため):
    //   - P0001: トリガー integration_connections_validate_import_config の raise exception
    //            (org 外の space/assignee 指定 / import_config が object でない)→ 422
    //   - P0002: RPCの no_data_found(接続が消えていた)→ 404
    //   - 22023: 既存の import_config / p_patch の型が壊れている(再試行しても直らない)→ 422
    //   - 22P02: target_space_id/default_assignee_id が UUID 形式でない(::uuid キャスト失敗)→ 400
    //   - それ以外(一時障害・想定外)→ 500(内部文言は返さずログのみ)
    const code = (error as { code?: string }).code
    if (code === 'P0001') {
      return NextResponse.json(
        { error: '取り込み先はこの組織のスペース/メンバーのみ指定できます' },
        { status: 422 },
      )
    }
    if (code === 'P0002') {
      return NextResponse.json({ error: 'connection not found' }, { status: 404 })
    }
    if (code === '22023') {
      return NextResponse.json(
        { error: 'この接続の取り込み設定が壊れています。設定を作り直してください' },
        { status: 422 },
      )
    }
    if (code === '22P02') {
      return NextResponse.json(
        { error: 'target_space_id / default_assignee_id は UUID 形式で指定してください' },
        { status: 400 },
      )
    }
    console.error('[import-config] update failed:', (error as { message?: string }).message)
    return NextResponse.json({ error: 'failed to update import_config' }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: 'connection not found' }, { status: 404 })
  }

  const merged = data as { id: string; import_config: Record<string, unknown>; import_enabled: boolean }
  return NextResponse.json({
    id: merged.id,
    // ⚠ kintone_app_tokens 等のクライアント非公開キーは応答からも必ず取り除く（このRPCはDB上の
    // import_config全体を返すため、ここで通さないと暗号化blobがそのままクライアントへ漏れる。
    // importConfig.ts 冒頭参照）。
    import_config: sanitizeImportConfigForClient(merged.import_config),
    import_enabled: merged.import_enabled,
  })
}
