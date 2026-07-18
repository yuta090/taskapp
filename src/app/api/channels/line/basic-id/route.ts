import { NextRequest, NextResponse } from 'next/server'
import { requireInternalMember } from '@/lib/channels/authz'
import { getLineBasicIdWithOwnerTypeForOrg } from '@/lib/channels/store'
import { isValidUuid } from '@/lib/uuid'

export const runtime = 'nodejs'

/**
 * GET /api/channels/line/basic-id?orgId=... — 友だち追加QR用の basic_id（公開情報）取得。
 *
 * channel_accounts は資格情報テーブルでRLS上 service_role 専用。ここで service role で
 * 判定し、**basicId と ownerType（文言分岐用）のみ** を返す。credentials / access_token は
 * 一切返さない（漏えい面を作らない。line-status API と同じ規律）。
 *
 * basicId は「Botを見つけて友だち追加する手間」を消すQRの材料に過ぎない。
 * 本人特定（identity）は従来どおりコード返信方式のみが正 — このAPIはそれを一切変更しない。
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

  try {
    const result = await getLineBasicIdWithOwnerTypeForOrg(orgId)
    return NextResponse.json({
      basicId: result?.basicId ?? null,
      ownerType: result?.ownerType ?? null,
    })
  } catch (error) {
    console.error('line/basic-id: failed', error)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}
