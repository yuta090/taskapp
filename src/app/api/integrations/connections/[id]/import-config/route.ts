import { NextRequest, NextResponse } from 'next/server'
import { requireOrgAdmin } from '@/lib/channels/authz'
import { isValidUuid } from '@/lib/uuid'
import { createAdminClient } from '@/lib/supabase/admin'

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

interface ConnectionOrgAndConfig {
  orgId: string
  importConfig: Record<string, unknown>
}

/**
 * 接続の org_id と現在の import_config を1回で引く。
 *
 * 更新のたびに「今の値」を必要とするのは、import_config の一部フィールドを
 * サーバ管理・部分更新にするため(PATCH本体の説明を参照)。
 */
async function findConnectionOrgAndConfig(id: string): Promise<ConnectionOrgAndConfig | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('integration_connections')
    .select('org_id, import_config')
    .eq('id', id)
    .maybeSingle()
  if (error || !data) return null
  const row = data as { org_id: string; import_config: Record<string, unknown> | null }
  return { orgId: row.org_id, importConfig: row.import_config ?? {} }
}

/**
 * PATCH /api/integrations/connections/[id]/import-config — owner/adminのみ。
 *
 * import_config( { target_space_id, read_list_ids?, default_assignee_id? } )と、
 * 任意で import_enabled(取り込みの有効/無効)を**同じ更新で**変更する
 * (器は 20260720125427_connector_two_way_sync.sql で追加済み)。
 *
 * org境界の検証(target_space_id/default_assignee_idが接続と同じorgを指すか)はDBトリガー
 * (integration_connections_validate_import_config)が担う。トリガー例外はここで捕捉し、
 * ユーザー向けメッセージに変換して422で返す(内部エラーメッセージをそのまま漏らさない)。
 *
 * ⚠ import_config の一部フィールドはサーバ管理・部分更新にする(丸ごと置換による事故を防ぐ):
 *   - notion_mappings: Notionの確認保存API(connections/notion/mapping/route.ts)だけが、
 *     ライブスキーマ再取得での検証を経て書ける「確定済みデータ」。この汎用PATCHでクライアントの
 *     送信値をそのまま採用すると、(a) 保存APIの検証を迂回して実在しないprop_idを含む
 *     マッピングを永続化できてしまう（＝「設定済みに見えるのに取り込みが止まる」状態を作れる）、
 *     (b) この汎用PATCHで別項目(target_space_id等)を変えただけで確定済みマッピングが
 *     丸ごと消えてしまう、という2つの事故が起きる。そのため、クライアントが何を送ってきても
 *     常にDB上の現在値を引き継ぐ（400で弾かない: 現在値をそのまま送り返す正当な実装の
 *     クライアントまで壊してしまうため。なぜ拒否せず無視するのかをここに明記する）。
 *   - read_container_ids: Notion以外のproviderでも運用者が正当に編集する項目なので上書きは
 *     許すが、「キー自体を送らなかった」場合にまで消えるのは(b)と同種の事故になるため、
 *     未指定なら現在値を保持する(部分更新セマンティクス。空配列を明示的に送れば
 *     意図的なクリアとして通る)。
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: 'invalid connection id' }, { status: 400 })
  }

  const found = await findConnectionOrgAndConfig(id)
  if (!found) {
    return NextResponse.json({ error: 'connection not found' }, { status: 404 })
  }
  const { orgId, importConfig: currentConfig } = found

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

  const bodyConfig = body.import_config as Record<string, unknown>
  const nextConfig: Record<string, unknown> = { ...bodyConfig }

  // notion_mappings: クライアント送信値は無視し、常にDBの現在値を引き継ぐ(上記コメント参照)。
  if (Object.prototype.hasOwnProperty.call(currentConfig, 'notion_mappings')) {
    nextConfig.notion_mappings = currentConfig.notion_mappings
  } else {
    delete nextConfig.notion_mappings
  }

  // kintone_mappings/kintone_app_ids: notion_mappings と同じ理由・同じ保護
  // (フィールドコード＋選択肢名の対応づけは kintone/schema.ts のライブスキーマ検証を経て初めて
  // 確定する「確定済みデータ」であり、この汎用PATCHでクライアント送信値をそのまま採用すると、
  // (a) 検証を迂回して実在しないフィールドコードを含むマッピングを永続化できてしまう、
  // (b) この汎用PATCHで別項目(target_space_id等)を変えただけで確定済みの設定が丸ごと消える、
  // という同種の2つの事故が起きる)。クライアントが何を送ってきても常にDB上の現在値を引き継ぐ。
  if (Object.prototype.hasOwnProperty.call(currentConfig, 'kintone_mappings')) {
    nextConfig.kintone_mappings = currentConfig.kintone_mappings
  } else {
    delete nextConfig.kintone_mappings
  }
  if (Object.prototype.hasOwnProperty.call(currentConfig, 'kintone_app_ids')) {
    nextConfig.kintone_app_ids = currentConfig.kintone_app_ids
  } else {
    delete nextConfig.kintone_app_ids
  }

  // read_container_ids: キー自体が送られてこなかった場合だけ現在値を保持する(部分更新)。
  if (!Object.prototype.hasOwnProperty.call(bodyConfig, 'read_container_ids')) {
    if (Object.prototype.hasOwnProperty.call(currentConfig, 'read_container_ids')) {
      nextConfig.read_container_ids = currentConfig.read_container_ids
    } else {
      delete nextConfig.read_container_ids
    }
  }

  const patch: Record<string, unknown> = { import_config: nextConfig }
  if (typeof body.import_enabled === 'boolean') patch.import_enabled = body.import_enabled

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('integration_connections')
    .update(patch)
    .eq('id', id)
    .select('id, import_config, import_enabled')
    .maybeSingle()

  if (error) {
    // DBエラーは SQLSTATE で切り分ける(全DBエラーを恒久422に潰さない。一時障害を誤って
    // 「入力が恒久的に不正」と誤認させないため):
    //   - P0001: トリガー integration_connections_validate_import_config の raise exception
    //            (org 外の space/assignee 指定 / import_config が object でない)→ 422
    //   - 22P02: target_space_id/default_assignee_id が UUID 形式でない(::uuid キャスト失敗)→ 400
    //   - それ以外(一時障害・想定外)→ 500(内部文言は返さずログのみ)
    const code = (error as { code?: string }).code
    if (code === 'P0001') {
      return NextResponse.json(
        { error: '取り込み先はこの組織のスペース/メンバーのみ指定できます' },
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

  return NextResponse.json({
    id: (data as { id: string }).id,
    import_config: (data as { import_config: Record<string, unknown> }).import_config,
    import_enabled: (data as { import_enabled: boolean }).import_enabled,
  })
}
