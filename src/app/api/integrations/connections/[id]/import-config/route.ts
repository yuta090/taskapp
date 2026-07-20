import { NextRequest, NextResponse } from 'next/server'
import { requireOrgAdmin } from '@/lib/channels/authz'
import { isValidUuid } from '@/lib/uuid'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

interface PatchImportConfigBody {
  import_config?: unknown
}

async function findConnectionOrgId(id: string): Promise<string | null> {
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
 * import_config( { target_space_id, read_list_ids?, default_assignee_id? } )を更新する
 * (器は 20260720125427_connector_two_way_sync.sql で追加済み)。
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

  const orgId = await findConnectionOrgId(id)
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

  if (
    typeof body.import_config !== 'object' ||
    body.import_config === null ||
    Array.isArray(body.import_config)
  ) {
    return NextResponse.json({ error: 'import_config must be an object' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('integration_connections')
    .update({ import_config: body.import_config })
    .eq('id', id)
    .select('id, import_config')
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
  })
}
