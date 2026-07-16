import { NextRequest, NextResponse } from 'next/server'
import { requireInternalMember } from '@/lib/channels/authz'
import {
  verifySpaceInOrg,
  findFirstPlatformAccountId,
  createSharedGroupClaimCode,
  DuplicateSharedGroupClaimCodeError,
} from '@/lib/channels/store'
import {
  generateSharedGroupClaimCode,
  hashSharedGroupClaimCode,
  formatGroupClaimCodeForDisplay,
  WEB_APPROVAL_CLAIM_TTL_MS,
} from '@/lib/channels/sharedGroupClaim'
import { isValidUuid } from '@/lib/uuid'

export const runtime = 'nodejs'

/**
 * POST /api/channels/group-claims/issue — 共有botグループ紐付けコード発行（web_approval・Stage 4・PR3a）
 *
 * 事務所が顧問先へ渡し、顧問先がLINEグループに投入する。投入されると
 * /api/channels/group-claims/pending に確認待ちとして現れ、内部ユーザーが承認/却下する
 * （promoteのdigest承認とは別概念・別route。GroupClaim系で命名を統一）。
 *
 * 対象accountはPR3aでは単一のplatform account（共有bot）を前提とし、クライアントからは
 * 受け取らずサーバ側で解決する（複数account選択はPR3bで詰める。設計正本 §10）。
 */
export async function POST(request: NextRequest) {
  let body: { orgId?: unknown; spaceId?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const orgId = typeof body.orgId === 'string' ? body.orgId : ''
  const spaceId = typeof body.spaceId === 'string' ? body.spaceId : ''
  if (!isValidUuid(orgId) || !isValidUuid(spaceId)) {
    return NextResponse.json({ error: 'orgId and spaceId are required' }, { status: 400 })
  }

  const auth = await requireInternalMember(orgId)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  // org境界: 他orgのspaceにコードを発行させない
  if (!(await verifySpaceInOrg(orgId, spaceId))) {
    return NextResponse.json({ error: 'space not found in org' }, { status: 404 })
  }

  const targetAccountId = await findFirstPlatformAccountId()
  if (!targetAccountId) {
    return NextResponse.json({ error: '共有botが未設定です' }, { status: 400 })
  }

  // code_hashの衝突(unique違反)に限りリトライ。それ以外は即エラー
  for (let attempt = 0; attempt < 3; attempt++) {
    const canonicalCode = generateSharedGroupClaimCode()
    try {
      const created = await createSharedGroupClaimCode({
        orgId,
        spaceId,
        targetAccountId,
        codeHash: hashSharedGroupClaimCode(canonicalCode),
        createdBy: auth.userId,
        expiresAt: new Date(Date.now() + WEB_APPROVAL_CLAIM_TTL_MS).toISOString(),
      })
      return NextResponse.json({
        id: created.id,
        // 平文はこの一度きり。DBにはcode_hashのみ残る
        code: formatGroupClaimCodeForDisplay(canonicalCode),
        expiresAt: created.expiresAt,
      })
    } catch (error) {
      if (error instanceof DuplicateSharedGroupClaimCodeError) continue
      console.error('group-claims/issue: failed to create', error)
      return NextResponse.json({ error: 'コードの発行に失敗しました' }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'コードの発行に失敗しました' }, { status: 500 })
}
