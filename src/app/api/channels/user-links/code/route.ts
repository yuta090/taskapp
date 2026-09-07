import { NextRequest, NextResponse } from 'next/server'
import { requireInternalMember } from '@/lib/channels/authz'
import { createUserLinkCode, findChannelAccountMetaById } from '@/lib/channels/store'
import { generateUserLinkCode, hashUserLinkCode } from '@/lib/channels/userLink'
import { isValidUuid } from '@/lib/uuid'

export const runtime = 'nodejs'

/** コードの有効期限（DB側の default と揃える。UIに出すためだけの値） */
const EXPIRES_IN_MINUTES = 15

/**
 * POST /api/channels/user-links/code — 内部ユーザーの本人紐付けコード発行
 *
 * 顧問先用の突合コード（/api/channels/link-codes）とは別物。
 * あちらは期限内マルチユース（紙を社長と経理の2人が読んでよい）だが、
 * こちらは *承認の本人性* を担保するためワンタイム・15分・使用即失効。
 *
 * 本人性の要（絶対に崩さないこと）:
 *   発行対象の user_id を **リクエストから受け取らない**。
 *   このAPIは service_role で INSERT するため、body の userId を信じると
 *   低権限ユーザーが org owner の UUID を指定してコードを発行し、
 *   自分のLINEを owner として紐付けられる（confused deputy）。
 *   よって常に検証済みセッションの userId を使う。
 *
 * 平文のコードはこのレスポンスでしか存在しない（DBには sha256 のみ）。
 */
export async function POST(request: NextRequest) {
  let body: { orgId?: unknown; channelAccountId?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const orgId = typeof body.orgId === 'string' ? body.orgId : ''
  const channelAccountId = typeof body.channelAccountId === 'string' ? body.channelAccountId : ''
  if (!isValidUuid(orgId) || !isValidUuid(channelAccountId)) {
    return NextResponse.json(
      { error: 'orgId and channelAccountId are required' },
      { status: 400 },
    )
  }

  const auth = await requireInternalMember(orgId)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  // org境界: 他orgの口座宛てにコードを発行させない（DB側の複合FKでも防いでいるが、
  // ここで弾いた方がエラーが分かりやすく、確実）。口座は id で引き org を照合する
  // （LINE だけでなく Slack など自社の口座ならどれでも発行できる。共通LINE(platform)は
  // org_id を持たないため照合で落ちる）。
  // 復号付きの lookup ではなく meta を使う: org確認のためだけに秘密を復号しない。
  const account = await findChannelAccountMetaById(channelAccountId)
  if (!account || account.orgId !== orgId) {
    return NextResponse.json({ error: 'channel account not found in org' }, { status: 404 })
  }

  const code = generateUserLinkCode()
  await createUserLinkCode(orgId, auth.userId, channelAccountId, hashUserLinkCode(code))

  // 平文を返すのはここだけ。ログには絶対に出さない
  return NextResponse.json({ code, expiresInMinutes: EXPIRES_IN_MINUTES })
}
