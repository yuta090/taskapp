import { NextRequest, NextResponse } from 'next/server'
import { requireInternalMember } from '@/lib/channels/authz'
import {
  verifySpaceInOrg,
  findFirstPlatformAccountId,
  createSharedGroupClaimCode,
  orgLineGroupCapacity,
  getLineSelfServeState,
  orgExternalChatGroupCapacity,
  DuplicateSharedGroupClaimCodeError,
  MultiplePlatformAccountsError,
} from '@/lib/channels/store'
import { canUseSharedBotClaims } from '@/lib/channels/sharedBotAccess'
import {
  generateSharedGroupClaimCode,
  hashSharedGroupClaimCode,
  formatGroupClaimCodeForDisplay,
  WEB_APPROVAL_CLAIM_TTL_MS,
} from '@/lib/channels/sharedGroupClaim'
import { isValidUuid } from '@/lib/uuid'
import { getChannel } from '@/lib/channels/registry'
import { resolveOrgEntitlements } from '@/lib/billing/entitlements'
import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

/**
 * POST /api/channels/group-claims/issue — 共有botグループ紐付けコード発行（web_approval・Stage 4・PR3a）
 *
 * 事務所が顧問先へ渡し、顧問先がLINEグループ等に投入する。投入されると
 * /api/channels/group-claims/pending に確認待ちとして現れ、内部ユーザーが承認/却下する
 * （promoteのdigest承認とは別概念・別route。GroupClaim系で命名を統一）。
 *
 * 対象accountは単一のplatform account（共有bot）を前提とし、クライアントからは
 * 受け取らずサーバ側で解決する（複数account選択は未対応。設計正本 §10）。
 *
 * channel対応（PR-b追補）: body.channel 省略時は 'line'（既定・挙動は完全に不変）。
 * 'line' 以外（google_chat 等の platform Pro チャネル）は、共通LINEの申込ゲート
 * （canUseSharedBotClaims/orgLineGroupCapacity）ではなく、Pro entitlement
 * （external_chat_channels）＋別枠の容量（orgExternalChatGroupCapacity）で判定する。
 * LINE経路の分岐・関数・エラー文言は1バイトも変えない。
 */
export async function POST(request: NextRequest) {
  let body: { orgId?: unknown; spaceId?: unknown; channel?: unknown }
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

  // channel省略時は 'line'（既定・後方互換）。未知チャネルは400。
  const channel = typeof body.channel === 'string' && body.channel ? body.channel : 'line'
  if (!getChannel(channel)) {
    return NextResponse.json({ error: 'unknown channel' }, { status: 400 })
  }

  const auth = await requireInternalMember(orgId)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  // org境界: 他orgのspaceにコードを発行させない
  if (!(await verifySpaceInOrg(orgId, spaceId))) {
    return NextResponse.json({ error: 'space not found in org' }, { status: 404 })
  }

  if (channel === 'line') {
    // 共通LINE利用の確立境界: 未申込/申込中の org には新規コードを発行しない（既存は切らない）。
    // 自社bot(own)・開通済み(granted)のみ許可。dead-end にせず申込導線つきで返す。
    if (!canUseSharedBotClaims(await getLineSelfServeState(orgId))) {
      return NextResponse.json(
        {
          error: '共通LINEのご利用にはお申し込みが必要です。お申し込み後、当社が開通してご案内します。',
          code: 'shared_bot_access_required',
        },
        { status: 403 },
      )
    }

    // プラン上限（相手先グループ数）: 既に上限なら、コードを渡す前に早期に止める（UX）。
    // ハードな上限適用は承認時（active化の瞬間）に行う。既存グループは切らない。
    const cap = await orgLineGroupCapacity(orgId)
    if (cap.maxGroups !== null && cap.activeCount >= cap.maxGroups) {
      return NextResponse.json(
        {
          error: '接続できる相手先グループ数の上限に達しています。Proにアップグレードすると増やせます。',
          code: 'group_limit_reached',
          limit: cap.maxGroups,
        },
        { status: 402 },
      )
    }
  } else {
    // LINE以外（google_chat 等）はPro専有の外部チャット枠。共通LINE申込ゲートは掛けず、
    // entitlement(external_chat_channels)と別枠の容量(orgExternalChatGroupCapacity)で判定する。
    const admin = createAdminClient() as SupabaseClient
    const ent = await resolveOrgEntitlements(admin, orgId)
    if (!ent.has('external_chat_channels')) {
      return NextResponse.json(
        {
          error: 'このチャットの利用にはProプランへのアップグレードが必要です。',
          code: 'external_chat_channels_required',
        },
        { status: 402 },
      )
    }

    const cap = await orgExternalChatGroupCapacity(orgId, channel)
    if (cap.max !== null && cap.activeCount >= cap.max) {
      return NextResponse.json(
        {
          error: '接続できる相手先グループ数の上限に達しています。追加はお問い合わせください（営業窓口でご案内します）。',
          code: 'group_limit_reached',
          limit: cap.max,
        },
        { status: 402 },
      )
    }
  }

  let targetAccountId: string | null
  try {
    // channelは省略時'line'（既定値と一致）。line経路は findFirstPlatformAccountId() と等価。
    targetAccountId = await findFirstPlatformAccountId(channel)
  } catch (error) {
    if (error instanceof MultiplePlatformAccountsError) {
      // L2ガード（設計正本 §10）: 複数botの明示選択は未対応。沈黙のdead-endにせず明確に拒否する
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
