import { NextRequest, NextResponse } from 'next/server'
import { requireInternalMember, requireOrgAdmin } from '@/lib/channels/authz'
import {
  findChannelAccountMetaForOrg,
  findChannelAccountOrgId,
  updateChannelAccountStatus,
  type ChannelAccountMeta,
} from '@/lib/channels/store'
import { isValidUuid } from '@/lib/uuid'

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

  const updated = await updateChannelAccountStatus(accountId, status)
  if (!updated) {
    return NextResponse.json({ error: '更新に失敗しました' }, { status: 500 })
  }

  return NextResponse.json({ account: toWireAccount(updated) })
}
