import { NextRequest, NextResponse } from 'next/server'
import { requireInternalMember } from '@/lib/channels/authz'
import {
  findGroupClaimOrgAndChannel,
  approveGroupClaim,
  rejectGroupClaim,
  orgLineGroupCapacity,
  orgExternalChatGroupCapacity,
  orgHasExternalChatChannels,
  getLineSelfServeState,
  GroupClaimActionError,
} from '@/lib/channels/store'
import { canUseSharedBotClaims } from '@/lib/channels/sharedBotAccess'
import { isValidUuid } from '@/lib/uuid'

export const runtime = 'nodejs'

/**
 * POST /api/channels/group-claims/approval — 共有botグループ紐付けの承認/却下（Stage 4・PR3a）
 *
 * {orgId, claimId, action: 'approve'|'reject'}
 * 内部メンバーのみ入口を通す。承認者user_idは必ずセッション(auth.getUser)から解決し、
 * クライアント申告は受け取らない（設計正本 §3）。
 * 可否の最終判定は rpc_approve_group_claim / rpc_reject_group_claim が再検証する（route は薄い）。
 *
 * promoteのdigest承認 (/api/channels/digest-tasks/approval) とは別route・別store関数を使う
 * （rpc_promote_digest_task 系には触れない）。
 */
export async function POST(request: NextRequest) {
  let parsed: unknown
  try {
    parsed = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const body = parsed as { orgId?: unknown; claimId?: unknown; action?: unknown }

  const orgId = typeof body.orgId === 'string' ? body.orgId : ''
  const claimId = typeof body.claimId === 'string' ? body.claimId : ''
  const action = typeof body.action === 'string' ? body.action : ''

  if (!isValidUuid(orgId) || !isValidUuid(claimId)) {
    return NextResponse.json({ error: 'orgId and claimId are required' }, { status: 400 })
  }
  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json({ error: 'action must be approve or reject' }, { status: 400 })
  }

  const auth = await requireInternalMember(orgId)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  // 越権・他orgのclaimを早期に弾く（RPCもcode.org境界を束縛するが、明快な404を返すための防御）。
  // 併せて claim のチャネルを引く（LINE と外部チャットで容量/エンタイトルメントの適用先が異なる）。
  const claimRef = await findGroupClaimOrgAndChannel(claimId)
  if (!claimRef || claimRef.orgId !== orgId) {
    return NextResponse.json({ error: 'claim not found' }, { status: 404 })
  }

  try {
    if (action === 'approve') {
      // プラン上限: 承認＝新規グループのactive化なので、ここが上限のハード適用点。
      // 既存グループは絶対に切らない。上限到達時は新規承認のみ 402 で拒否しアップグレードへ誘導。
      // ★チャネル分岐: LINE共有botは Free でも紐付け可（maxLineGroups枠）。
      //   Discord等の外部チャットは Pro の売り＝external_chat_channels 必須＋maxExternalChatGroups枠。
      if (claimRef.channel === 'line') {
        // 共通LINE利用の確立境界の二重化（issue の 403 を通り抜けた in-flight claim の最後の砦）。
        // approve=新規active化のみ対象。reject は非granted でも許す（紐付けを作らないため）。own/granted のみ承認可。
        if (!canUseSharedBotClaims(await getLineSelfServeState(orgId))) {
          return NextResponse.json(
            {
              error: '共通LINEのご利用にはお申し込みが必要です。お申し込み後、当社が開通してご案内します。',
              code: 'shared_bot_access_required',
            },
            { status: 403 },
          )
        }
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
        // 外部チャット: まず Pro エンタイトルメント（external_chat_channels）が無ければ確立させない。
        const entitled = await orgHasExternalChatChannels(orgId)
        if (!entitled) {
          return NextResponse.json(
            {
              error: 'LINE以外のチャット連携はProプランの機能です。Proにアップグレードするとご利用いただけます。',
              code: 'external_chat_not_entitled',
            },
            { status: 402 },
          )
        }
        const cap = await orgExternalChatGroupCapacity(orgId, claimRef.channel)
        if (cap.max !== null && cap.activeCount >= cap.max) {
          return NextResponse.json(
            {
              error: '接続できる相手先グループ数の上限に達しています。Proの上限を増やすと追加できます。',
              code: 'group_limit_reached',
              limit: cap.max,
            },
            { status: 402 },
          )
        }
      }
      const ok = await approveGroupClaim(claimId, auth.userId)
      if (!ok) {
        // 同一グループへの2claim同時承認の敗者（channel_groups_active_uniqueによるgraceful reject）
        return NextResponse.json({ error: 'conflict' }, { status: 409 })
      }
      return NextResponse.json({ status: 'approved' })
    }

    const ok = await rejectGroupClaim(claimId, auth.userId)
    if (!ok) {
      return NextResponse.json({ error: 'conflict' }, { status: 409 })
    }
    return NextResponse.json({ status: 'rejected' })
  } catch (error) {
    if (error instanceof GroupClaimActionError) {
      const status =
        error.reason === 'not_found'
          ? 404
          : error.reason === 'forbidden'
            ? 403
            : error.reason === 'invalid'
              ? 422
              : 409
      return NextResponse.json({ error: error.reason }, { status })
    }
    console.error('group-claims/approval: unexpected error', error)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}
