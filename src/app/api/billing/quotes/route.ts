import { NextRequest, NextResponse } from 'next/server'
import { requireInternalMember } from '@/lib/channels/authz'
import { UUID_REGEX } from '@/lib/uuid'
import {
  listOrgQuotes,
  createQuoteRequest,
  QuoteConflictError,
} from '@/lib/billing/quoteStore'

/**
 * 枠追加の見積もり（顧客側）。
 *
 * GET  /api/billing/quotes?orgId= — 自組織の見積もり一覧
 * POST /api/billing/quotes        — 枠追加を依頼する（金額は当社が後から提示）
 *
 * 認可: **org の owner のみ**。承認＝支払いの約束になるため、閲覧・依頼の時点から
 * owner に限定する（member/client には見せない）。
 */

const MAX_NOTE_LENGTH = 500

async function requireOwner(orgId: string) {
  const auth = await requireInternalMember(orgId)
  if (!auth.ok) return auth
  if (auth.role !== 'owner') {
    return { ok: false as const, status: 403 as const, error: 'Owner only' }
  }
  return auth
}

export async function GET(request: NextRequest) {
  const orgId = new URL(request.url).searchParams.get('orgId') ?? ''
  if (!UUID_REGEX.test(orgId)) {
    return NextResponse.json({ error: 'orgId is required' }, { status: 400 })
  }

  const auth = await requireOwner(orgId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const quotes = await listOrgQuotes(orgId)
  return NextResponse.json({ quotes })
}

export async function POST(request: NextRequest) {
  let body: { orgId?: unknown; note?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const orgId = typeof body.orgId === 'string' ? body.orgId : ''
  if (!UUID_REGEX.test(orgId)) {
    return NextResponse.json({ error: 'orgId is required' }, { status: 400 })
  }

  const note = typeof body.note === 'string' ? body.note.trim() : ''
  if (!note) {
    return NextResponse.json({ error: 'ご希望の内容を入力してください' }, { status: 400 })
  }
  if (note.length > MAX_NOTE_LENGTH) {
    return NextResponse.json({ error: 'ご希望の内容が長すぎます' }, { status: 400 })
  }

  const auth = await requireOwner(orgId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const quote = await createQuoteRequest({ orgId, userId: auth.userId, note })
    return NextResponse.json({ quote })
  } catch (err) {
    if (err instanceof QuoteConflictError) {
      return NextResponse.json(
        { error: err.message, code: 'quote_already_open' },
        { status: 409 },
      )
    }
    console.error('[billing/quotes] create failed:', err)
    return NextResponse.json({ error: 'お見積もりの依頼に失敗しました' }, { status: 500 })
  }
}
