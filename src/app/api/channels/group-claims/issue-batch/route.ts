import { NextRequest, NextResponse } from 'next/server'
import { requireOrgAdmin } from '@/lib/channels/authz'
import {
  isCodeOnlyEntitled,
  verifySpacesInOrg,
  countOutstandingCodeOnlyCodes,
  findFirstPlatformAccountId,
  createCodeOnlyClaimCodesBatch,
  MultiplePlatformAccountsError,
} from '@/lib/channels/store'
import { CODE_ONLY_CLAIM_DEFAULT_TTL_MS, CODE_ONLY_OUTSTANDING_LIMIT_PER_ORG } from '@/lib/channels/sharedGroupClaim'
import { isValidUuid } from '@/lib/uuid'

export const runtime = 'nodejs'

/**
 * POST /api/channels/group-claims/issue-batch — code_only の本部一括発行（Stage 4・PR3b）
 *
 * 本部/多拠点の一括登録用: 複数spaceに対し一度にcode_onlyコードを発行する。
 * owner/admin限定（requireOrgAdmin。web_approvalのissueより厳しい — 一括発行は運用影響が大きいため）。
 * entitlement(allow_code_only)が無いorgは拒否（設計正本 §3 (k)）。
 * 発行レート上限（未消費code_onlyコード数/org。既存分＋今回発行分が上限を超えたら拒否）を課す。
 * 平文コードはこの応答一度きり（DBにはcode_hashのみ残る）。
 */
export async function POST(request: NextRequest) {
  let body: { orgId?: unknown; spaceIds?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const orgId = typeof body.orgId === 'string' ? body.orgId : ''
  const spaceIdsRaw = Array.isArray(body.spaceIds) ? body.spaceIds : null

  if (!isValidUuid(orgId) || !spaceIdsRaw || spaceIdsRaw.length === 0) {
    return NextResponse.json({ error: 'orgId and spaceIds are required' }, { status: 400 })
  }
  const spaceIds = [...new Set(spaceIdsRaw)]
  if (spaceIds.some((id) => typeof id !== 'string' || !isValidUuid(id))) {
    return NextResponse.json({ error: 'spaceIds must be valid UUIDs' }, { status: 400 })
  }
  // 早期の上限チェック（cheap）: どのorgでも1リクエストの発行数がこの上限を超えることは無い
  // ため、DB往復(verifySpacesInOrgの巨大in())の前にここで弾く。org単位の既存未消費数との
  // 合算チェックは引き続き countOutstandingCodeOnlyCodes 側で行う（TOCTOU上は緩いソフト上限）。
  if (spaceIds.length > CODE_ONLY_OUTSTANDING_LIMIT_PER_ORG) {
    return NextResponse.json(
      { error: `一度に発行できるのは${CODE_ONLY_OUTSTANDING_LIMIT_PER_ORG}件までです` },
      { status: 400 },
    )
  }

  const auth = await requireOrgAdmin(orgId)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  if (!(await isCodeOnlyEntitled(orgId))) {
    return NextResponse.json({ error: 'このorgはcode_only発行が許可されていません' }, { status: 403 })
  }

  // org境界: 他orgのspaceへ発行させない
  if (!(await verifySpacesInOrg(orgId, spaceIds))) {
    return NextResponse.json({ error: 'space not found in org' }, { status: 404 })
  }

  const outstanding = await countOutstandingCodeOnlyCodes(orgId)
  if (outstanding + spaceIds.length > CODE_ONLY_OUTSTANDING_LIMIT_PER_ORG) {
    return NextResponse.json(
      { error: `未消費のcode_onlyコードが上限(${CODE_ONLY_OUTSTANDING_LIMIT_PER_ORG})を超えます` },
      { status: 429 },
    )
  }

  let targetAccountId: string | null
  try {
    targetAccountId = await findFirstPlatformAccountId()
  } catch (error) {
    if (error instanceof MultiplePlatformAccountsError) {
      return NextResponse.json(
        { error: '共有botが複数存在するため自動選択できません。管理者にご連絡ください。' },
        { status: 409 },
      )
    }
    throw error
  }
  if (!targetAccountId) {
    return NextResponse.json({ error: '共有botが未設定です' }, { status: 400 })
  }

  try {
    const items = await createCodeOnlyClaimCodesBatch({
      orgId,
      spaceIds,
      targetAccountId,
      createdBy: auth.userId,
    })
    return NextResponse.json({
      items,
      // 平文コードはこの一度きり。DBにはcode_hashのみ残る（表示用のTTL目安）
      expiresAt: new Date(Date.now() + CODE_ONLY_CLAIM_DEFAULT_TTL_MS).toISOString(),
    })
  } catch (error) {
    console.error('group-claims/issue-batch: failed to create', error)
    return NextResponse.json({ error: 'コードの発行に失敗しました' }, { status: 500 })
  }
}
