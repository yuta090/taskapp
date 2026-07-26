import { NextRequest, NextResponse } from 'next/server'
import { requireInternalMember } from '@/lib/channels/authz'
import { UUID_REGEX } from '@/lib/uuid'
import { approveQuote, rejectQuote, getQuoteOrgId } from '@/lib/billing/quoteStore'

/**
 * POST /api/billing/quotes/[quoteId] — 提示された見積もりへの返事（顧客側）。
 *   body: { orgId, action: 'approve' | 'reject', amount?: number }
 *
 * 承認＝支払いの約束なので:
 *   - **org owner のみ**。承認者はセッションから解決する（クライアント申告は受けない）
 *   - `amount` は画面に表示されていた金額のエコーバック。行と違えば 409
 *     （提示が差し替わった古い画面から、意図しない金額を承認させない）
 *   - 二重押しの2回目は 409（RPC が status='offered' のアトミック遷移で弾く）
 *   - 期限切れは 410（行は expired に落ちる）
 */

const REASON_STATUS: Record<string, number> = {
  not_found: 404,
  not_offered: 409,
  expired: 410,
  amount_mismatch: 409,
}

const REASON_MESSAGE: Record<string, string> = {
  not_found: 'お見積もりが見つかりません',
  not_offered: 'このお見積もりは既に処理済みです。最新の状態をご確認ください。',
  expired: 'お見積もりの有効期限が切れています。お手数ですが再度ご依頼ください。',
  amount_mismatch:
    '表示中の金額が最新ではありません。画面を再読み込みして内容をご確認ください。',
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ quoteId: string }> },
) {
  const { quoteId } = await params
  if (!UUID_REGEX.test(quoteId)) {
    return NextResponse.json({ error: 'invalid quoteId' }, { status: 400 })
  }

  let body: { orgId?: unknown; action?: unknown; amount?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const orgId = typeof body.orgId === 'string' ? body.orgId : ''
  const action = body.action
  if (!UUID_REGEX.test(orgId)) {
    return NextResponse.json({ error: 'orgId is required' }, { status: 400 })
  }
  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json({ error: 'action must be approve or reject' }, { status: 400 })
  }

  const auth = await requireInternalMember(orgId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  if (auth.role !== 'owner') {
    return NextResponse.json({ error: 'Owner only' }, { status: 403 })
  }

  // 他orgの見積もりを自orgのIDで操作させない
  const quoteOrgId = await getQuoteOrgId(quoteId)
  if (!quoteOrgId || quoteOrgId !== orgId) {
    return NextResponse.json({ error: 'お見積もりが見つかりません' }, { status: 404 })
  }

  if (action === 'reject') {
    const ok = await rejectQuote(quoteId)
    if (!ok) {
      return NextResponse.json(
        { error: REASON_MESSAGE.not_offered, code: 'not_offered' },
        { status: 409 },
      )
    }
    return NextResponse.json({ ok: true, status: 'rejected' })
  }

  if (typeof body.amount !== 'number' || !Number.isFinite(body.amount)) {
    return NextResponse.json(
      { error: '承認には表示中の金額が必要です', code: 'amount_required' },
      { status: 400 },
    )
  }

  const result = await approveQuote(quoteId, auth.userId, body.amount)
  if (!result.ok) {
    return NextResponse.json(
      { error: REASON_MESSAGE[result.reason], code: result.reason },
      { status: REASON_STATUS[result.reason] ?? 409 },
    )
  }

  return NextResponse.json({ ok: true, status: 'approved' })
}
