import { NextRequest, NextResponse } from 'next/server'
import { requireInternalMember, requireOrgAdmin } from '@/lib/channels/authz'
import { listActiveUserLinks, revokeUserLink, findUserLinkById } from '@/lib/channels/store'
import { isValidUuid } from '@/lib/uuid'

export const runtime = 'nodejs'

/** GET /api/channels/user-links?orgId=... — org内の active な本人紐付け一覧 */
export async function GET(request: NextRequest) {
  const orgId = new URL(request.url).searchParams.get('orgId') ?? ''
  if (!isValidUuid(orgId)) {
    return NextResponse.json({ error: 'orgId is required' }, { status: 400 })
  }

  const auth = await requireInternalMember(orgId)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const links = await listActiveUserLinks(orgId)

  // LINE userId は個人識別子。コンソールの表示に不要なので wire には出さない
  return NextResponse.json({
    links: links.map((link) => ({
      id: link.id,
      userId: link.userId,
      linkedAt: link.linkedAt,
    })),
  })
}

/**
 * DELETE /api/channels/user-links — 紐付けの失効
 *
 * 失効できるのは「本人」または「org admin」。
 * admin を含めるのは退職者対応のため（本人がログインできなくなった後も切れる必要がある）。
 * 他人の紐付けを一般メンバーが切れると、承認の妨害（DoS）に使えてしまう。
 */
export async function DELETE(request: NextRequest) {
  let body: { orgId?: unknown; linkId?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const orgId = typeof body.orgId === 'string' ? body.orgId : ''
  const linkId = typeof body.linkId === 'string' ? body.linkId : ''
  if (!isValidUuid(orgId) || !isValidUuid(linkId)) {
    return NextResponse.json({ error: 'orgId and linkId are required' }, { status: 400 })
  }

  const auth = await requireInternalMember(orgId)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  // org境界: 他orgの紐付けは存在ごと隠す
  const link = await findUserLinkById(linkId)
  if (!link || link.orgId !== orgId) {
    return NextResponse.json({ error: 'link not found in org' }, { status: 404 })
  }

  if (link.userId !== auth.userId) {
    const admin = await requireOrgAdmin(orgId)
    if (!admin.ok) {
      return NextResponse.json(
        { error: '他のメンバーの連携を解除できるのは管理者のみです' },
        { status: 403 },
      )
    }
  }

  // 二重失効は false（副作用ゼロ）。エラーにはしない
  const revoked = await revokeUserLink(linkId, auth.userId)
  return NextResponse.json({ revoked })
}
