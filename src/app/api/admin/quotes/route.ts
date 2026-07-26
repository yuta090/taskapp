import { NextRequest, NextResponse } from 'next/server'
import { verifySuperadmin } from '@/lib/admin/verify-superadmin'
import { UUID_REGEX } from '@/lib/uuid'
import {
  listOpenQuotes,
  listPendingSyncQuotes,
  offerQuote,
  cancelQuote,
  terminateQuote,
  markStripeSyncApplied,
} from '@/lib/billing/quoteStore'

/**
 * 枠追加の見積もり（当社側・superadmin専用）。
 *
 * GET   /api/admin/quotes — 依頼中/提示中の一覧＋「承認済みだが請求へ未反映」の作業待ち一覧
 * POST  /api/admin/quotes — 金額を提示する（requested → offered）
 * PATCH /api/admin/quotes — 取り下げ / 枠の終了 / 請求へ反映済みの記録
 *
 * 金額はここで人が決める（原価計算やパック単価の自動計算はしない＝価格が未確定のため）。
 */

const DEFAULT_EXPIRES_DAYS = 30
const MAX_AMOUNT_JPY = 10_000_000

function toNonNegativeInt(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return 0
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return null
  return n
}

export async function GET() {
  const adminUserId = await verifySuperadmin()
  if (!adminUserId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const [open, pendingSync] = await Promise.all([listOpenQuotes(), listPendingSyncQuotes()])
  return NextResponse.json({ open, pendingSync })
}

export async function POST(request: NextRequest) {
  const adminUserId = await verifySuperadmin()
  if (!adminUserId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const quoteId = typeof body.quoteId === 'string' ? body.quoteId : ''
  if (!UUID_REGEX.test(quoteId)) {
    return NextResponse.json({ error: 'quoteId is required' }, { status: 400 })
  }

  const amount = toNonNegativeInt(body.amountMonthlyJpy)
  if (amount === null || amount > MAX_AMOUNT_JPY) {
    return NextResponse.json({ error: 'amountMonthlyJpy is invalid' }, { status: 400 })
  }

  const addMembers = toNonNegativeInt(body.addMembers)
  const addLineGroups = toNonNegativeInt(body.addLineGroups)
  const addExternalChatGroups = toNonNegativeInt(body.addExternalChatGroups)
  if (addMembers === null || addLineGroups === null || addExternalChatGroups === null) {
    return NextResponse.json({ error: '加算は0以上の整数で指定してください' }, { status: 400 })
  }
  if (addMembers + addLineGroups + addExternalChatGroups === 0) {
    return NextResponse.json(
      { error: '増やす枠を1つ以上指定してください（0の提示は意味がありません）' },
      { status: 400 },
    )
  }

  const days = toNonNegativeInt(body.expiresInDays) || DEFAULT_EXPIRES_DAYS
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()

  const ok = await offerQuote({
    quoteId,
    adminUserId,
    amountMonthlyJpy: amount,
    addMembers,
    addLineGroups,
    addExternalChatGroups,
    note: typeof body.note === 'string' ? body.note : null,
    expiresAt,
  })

  if (!ok) {
    return NextResponse.json(
      { error: '依頼中の見積もりではありません（既に提示済み/取消済みの可能性）' },
      { status: 409 },
    )
  }
  return NextResponse.json({ ok: true, expiresAt })
}

export async function PATCH(request: NextRequest) {
  const adminUserId = await verifySuperadmin()
  if (!adminUserId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: { quoteId?: unknown; action?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const quoteId = typeof body.quoteId === 'string' ? body.quoteId : ''
  if (!UUID_REGEX.test(quoteId)) {
    return NextResponse.json({ error: 'quoteId is required' }, { status: 400 })
  }

  const action = body.action
  if (action !== 'cancel' && action !== 'terminate' && action !== 'markApplied') {
    return NextResponse.json(
      { error: 'action must be cancel | terminate | markApplied' },
      { status: 400 },
    )
  }

  const ok =
    action === 'cancel'
      ? await cancelQuote(quoteId)
      : action === 'terminate'
        ? await terminateQuote(quoteId)
        : await markStripeSyncApplied(quoteId)

  if (!ok) {
    return NextResponse.json({ error: '対象の状態が変わっています' }, { status: 409 })
  }
  return NextResponse.json({ ok: true })
}
