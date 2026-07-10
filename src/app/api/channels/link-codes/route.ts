import { NextRequest, NextResponse } from 'next/server'
import { requireInternalMember } from '@/lib/channels/authz'
import { createLinkCode } from '@/lib/channels/store'
import { generateLinkCode } from '@/lib/channels/linkCode'
import { isValidUuid } from '@/lib/uuid'

export const runtime = 'nodejs'

/**
 * POST /api/channels/link-codes — 顧問先突合コード発行
 *
 * 事務所が顧問先へ案内（メール雛形・請求書同封の紙/QR）し、
 * 顧問先が友だち追加後にLINEトークで送り返して本人特定する。
 * 期限内マルチユース（紙を社長と経理の2人が読んでもよい）。
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

  // コード衝突(31^8分の1)は理論上あり得るためリトライ
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const created = await createLinkCode({
        orgId,
        spaceId,
        code: generateLinkCode(),
        createdBy: auth.userId,
      })
      return NextResponse.json({
        id: created.id,
        code: created.code,
        expiresAt: created.expiresAt,
      })
    } catch (error) {
      lastError = error
    }
  }

  console.error('link-codes: failed to create', lastError)
  return NextResponse.json({ error: 'コードの発行に失敗しました' }, { status: 500 })
}
