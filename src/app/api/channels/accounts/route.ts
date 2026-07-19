import { NextRequest, NextResponse } from 'next/server'
import { requireInternalMember, requireOrgAdmin } from '@/lib/channels/authz'
import {
  findChannelAccountMetaForOrg,
  findChannelAccountOrgId,
  findChannelAccountOwnerType,
  updateChannelAccountStatus,
  type ChannelAccountMeta,
} from '@/lib/channels/store'
import { isValidUuid } from '@/lib/uuid'
import { resolveOrgEntitlements } from '@/lib/billing/entitlements'
import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

/** orgId/credentials_encryptedを含まないワイヤ向けの表現 */
function toWireAccount(meta: ChannelAccountMeta) {
  return {
    id: meta.id,
    channel: meta.channel,
    displayName: meta.displayName,
    lineBotUserId: meta.lineBotUserId,
    status: meta.status,
    createdAt: meta.createdAt,
  }
}

/**
 * GET /api/channels/accounts?orgId= — 秘書コンソールのbot状態カード用
 *
 * 内部メンバー(owner/admin/member)なら閲覧可。credentials_encryptedは選択自体しない。
 * viewerRoleを返し、フロントは owner/admin のときのみ有効/無効トグルを表示する。
 */
export async function GET(request: NextRequest) {
  const orgId = request.nextUrl.searchParams.get('orgId') ?? ''
  if (!isValidUuid(orgId)) {
    return NextResponse.json({ error: 'orgId is required' }, { status: 400 })
  }

  const auth = await requireInternalMember(orgId)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const account = await findChannelAccountMetaForOrg(orgId)
  return NextResponse.json({
    account: account ? toWireAccount(account) : null,
    viewerRole: auth.role,
  })
}

/**
 * PATCH /api/channels/accounts — bot有効/無効の切替。owner/adminのみ。
 *
 * accountIdの実所属org(サーバ側でservice roleにより解決)に対して権限確認する。
 * リクエストボディのorgIdは受け取らない(クライアント申告のorg境界を信用しない)。
 *
 * 課金ゲート（own_line_account・確立/有効化のみ）: 専用bot(owner_type='org')を
 * status='active' にする操作（新規登録の完了 or 無効化からの再有効化）は Pro 以上限定。
 * Free org は 402 own_line_account_required で拒否する。status='disabled'（無効化）は
 * プラン不問で常に許可する — 既存の専用bot接続を失効orgから強制的に切ることはしない
 * （このAPIはユーザー自身の無効化操作のみを扱い、こちらから切ることはない）。
 * 共有bot(owner_type='platform')の有効/無効はこのゲートの対象外。
 */
export async function PATCH(request: NextRequest) {
  let body: { accountId?: unknown; status?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const accountId = typeof body.accountId === 'string' ? body.accountId : ''
  const status = typeof body.status === 'string' ? body.status : ''

  if (!isValidUuid(accountId)) {
    return NextResponse.json({ error: 'accountId is required' }, { status: 400 })
  }
  if (status !== 'active' && status !== 'disabled') {
    return NextResponse.json({ error: "status must be 'active' or 'disabled'" }, { status: 400 })
  }

  const orgId = await findChannelAccountOrgId(accountId)
  if (!orgId) {
    return NextResponse.json({ error: 'account not found' }, { status: 404 })
  }

  const auth = await requireOrgAdmin(orgId)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  if (status === 'active') {
    const ownerType = await findChannelAccountOwnerType(accountId)
    if (ownerType === 'org') {
      const admin = createAdminClient() as SupabaseClient
      const ent = await resolveOrgEntitlements(admin, orgId)
      if (!ent.has('own_line_account')) {
        return NextResponse.json(
          {
            error: 'own_line_account_required',
            code: 'own_line_account_required',
            message: 'Proプランで自社LINE(専用bot)を有効化できます。',
          },
          { status: 402 },
        )
      }
    }
  }

  const updated = await updateChannelAccountStatus(accountId, status)
  if (!updated) {
    return NextResponse.json({ error: '更新に失敗しました' }, { status: 500 })
  }

  return NextResponse.json({ account: toWireAccount(updated) })
}
