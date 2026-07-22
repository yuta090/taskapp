import { NextRequest, NextResponse } from 'next/server'
import { requireOrgAdmin } from '@/lib/channels/authz'
import { isValidUuid } from '@/lib/uuid'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCredentials, type ConnectionCredentialRow } from '@/lib/task-sync/credentials'
import { getTaskSyncAdapter } from '@/lib/task-sync/adapters'

export const runtime = 'nodejs'

/**
 * GET /api/integrations/connections/[id]/containers?org_id=...
 *
 * 取り込み対象に選べる入れ物（Notion=データベース、Backlog=プロジェクト等）を一覧する
 * **provider非依存**のエンドポイント。取り込みマッピングウィザードの入口として、
 * どのツールでも同じ形（{id, title}[]）で「何が選べるか」を返す。
 *
 * 新しい一覧ロジックは持たない。真実源は各アダプタの listContainers（接続作成時の鍵検証
 * src/app/api/integrations/connections/task-sync/route.ts・実際の取り込み src/lib/task-sync/runner.ts
 * の両方が使っているのと同じ実装）をその場で1回呼ぶだけ。
 *
 * ⚠ 認可: requireOrgAdmin(owner/adminのみ) に加え、接続行を **id・org_id の両方**で絞って引く
 * （findConnection）。他orgの接続をIDだけで覗けないようにする境界は、notion/mapping系の
 * 既存2ルート（propose/route.ts・route.ts）と同じ形にする(このファイルだけの独自パターンにしない)。
 * provider では絞らない（provider非依存のエンドポイントのため）。
 *
 * エラー写像は notion/mapping 系ルートに揃える:
 *   - 401(トークン失効) → 409 + 再接続導線（403=DB共有無し等の「アクセス権無し」とは原因も
 *     対処も違うため区別する）
 *   - 403(アクセス権無し) → 400
 *   - それ以外（一時障害・想定外） → 502
 * トークン・応答本文は一切レスポンス/ログに出さない。
 */

interface ConnectionRow extends ConnectionCredentialRow {
  org_id: string
  provider: string
  import_config: Record<string, unknown> | null
}

/** connection_id を org_id 境界付きで引く。他orgの接続は絶対に引けない（provider不問=汎用のため）。 */
async function findConnection(connectionId: string, orgId: string): Promise<ConnectionRow | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('integration_connections')
    .select(
      'id, org_id, provider, auth_kind, base_url, access_token_encrypted, refresh_token_encrypted, refresh_token, import_config',
    )
    .eq('id', connectionId)
    .eq('org_id', orgId)
    .maybeSingle()
  if (error || !data) return null
  return data as ConnectionRow
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * 現在 read_container_ids に入っているIDを取り出す（UIが「取り込み中かどうか」を出せるように）。
 * 値の妥当性はここでは検証しない（表示専用の参考情報であり、保存経路の検証を代替しない）。
 */
function selectedContainerIds(importConfig: Record<string, unknown> | null): string[] {
  const raw = importConfig?.read_container_ids
  if (!Array.isArray(raw)) return []
  return raw.filter((v): v is string => typeof v === 'string')
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: connectionId } = await params
  if (!isValidUuid(connectionId)) {
    return NextResponse.json({ error: 'invalid connection id' }, { status: 400 })
  }

  const orgId = request.nextUrl.searchParams.get('org_id') ?? ''
  if (!isValidUuid(orgId)) {
    return NextResponse.json({ error: 'org_id is required' }, { status: 400 })
  }

  const auth = await requireOrgAdmin(orgId)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const connection = await findConnection(connectionId, orgId)
  if (!connection) {
    return NextResponse.json({ error: 'connection not found' }, { status: 404 })
  }

  const adapter = getTaskSyncAdapter(connection.provider)
  if (!adapter) {
    // DBのprovider列は形式チェックのみ。値の妥当性の真実源はこの登録表(task-sync/adapters.ts)。
    return NextResponse.json({ error: 'このツールはまだ対応していません' }, { status: 400 })
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

  let containers
  try {
    containers = await adapter.listContainers({
      credentials: cred.credentials,
      config: connection.import_config ?? {},
    })
  } catch (err) {
    const status = (err as { status?: number }).status
    if (status === 401) {
      // トークン失効。notion/mapping系ルートと同じ導線(409+再接続)に揃える。
      return NextResponse.json({ error: '接続が失効しています。再接続してください' }, { status: 409 })
    }
    if (status === 403) {
      return NextResponse.json({ error: 'アクセス権がありません' }, { status: 400 })
    }
    // トークン・応答本文はログに出さない(既存アダプタの流儀と同じ)。
    console.error(
      '[connections/containers] listContainers failed:',
      connection.provider,
      status ?? 'no-status',
      messageOf(err),
    )
    return NextResponse.json(
      { error: '接続先に到達できませんでした。時間をおいて再試行してください' },
      { status: 502 },
    )
  }

  return NextResponse.json({
    containers,
    selected_container_ids: selectedContainerIds(connection.import_config),
  })
}
