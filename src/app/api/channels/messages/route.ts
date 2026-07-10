import { NextRequest, NextResponse } from 'next/server'
import { requireInternalMember } from '@/lib/channels/authz'
import {
  findActiveIdentityForSpace,
  findLineAccountForOrg,
  insertChannelMessage,
  updateChannelMessageStatus,
} from '@/lib/channels/store'
import { pushLineMessage } from '@/lib/channels/line/client'
import { isValidUuid } from '@/lib/uuid'

export const runtime = 'nodejs'

/** LINEのテキスト上限は5000文字 */
const MAX_TEXT_LENGTH = 5000

/**
 * POST /api/channels/messages — 秘書名義の送信（WoZ期の送信UI用）
 *
 * 証跡が先、送信が後: queuedで記録 → LINE push → sent/failed 更新。
 * retryKey に行idを使い、再試行してもLINE側で二重配信されない。
 */
export async function POST(request: NextRequest) {
  let body: { orgId?: unknown; spaceId?: unknown; text?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const orgId = typeof body.orgId === 'string' ? body.orgId : ''
  const spaceId = typeof body.spaceId === 'string' ? body.spaceId : ''
  const text = typeof body.text === 'string' ? body.text.trim() : ''

  if (!isValidUuid(orgId) || !isValidUuid(spaceId)) {
    return NextResponse.json({ error: 'orgId and spaceId are required' }, { status: 400 })
  }
  if (!text || text.length > MAX_TEXT_LENGTH) {
    return NextResponse.json(
      { error: `text is required (max ${MAX_TEXT_LENGTH} chars)` },
      { status: 400 },
    )
  }

  const auth = await requireInternalMember(orgId)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const identity = await findActiveIdentityForSpace(orgId, spaceId, 'line')
  if (!identity) {
    return NextResponse.json(
      { error: 'この顧問先はまだLINE連携されていません（確認コードで突合してください）' },
      { status: 409 },
    )
  }

  const lookup = await findLineAccountForOrg(orgId)
  if (!lookup) {
    return NextResponse.json(
      { error: 'この事務所のLINEアカウントが未設定です' },
      { status: 409 },
    )
  }
  if (lookup.status === 'disabled') {
    // disabled = 受信の記録は続けるが能動的な動作は止める(§1)。送信APIもここで止まる
    return NextResponse.json(
      { error: 'LINEアカウントが無効化されています' },
      { status: 409 },
    )
  }
  const account = lookup.account
  if (!account) {
    // active だが復号失敗(資格情報破損等)。未設定と同じ扱いにする
    return NextResponse.json(
      { error: 'この事務所のLINEアカウントが未設定です' },
      { status: 409 },
    )
  }

  const inserted = await insertChannelMessage({
    orgId,
    spaceId,
    identityId: identity.id,
    accountId: account.id,
    channel: 'line',
    direction: 'outbound',
    actor: 'secretary',
    externalUserId: identity.externalId,
    externalMessageId: null,
    contentType: 'text',
    body: text,
    payload: {},
    storagePath: null,
    status: 'queued',
    error: null,
    occurredAt: new Date().toISOString(),
    sentBy: auth.userId,
  })

  if (inserted === 'duplicate') {
    return NextResponse.json({ error: 'duplicate message' }, { status: 409 })
  }

  try {
    await pushLineMessage({
      accessToken: account.accessToken,
      to: identity.externalId,
      messages: [{ type: 'text', text }],
      retryKey: inserted.id,
    })
    await updateChannelMessageStatus(inserted.id, 'sent', undefined)
    return NextResponse.json({ id: inserted.id, status: 'sent' })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await updateChannelMessageStatus(inserted.id, 'failed', message)
    return NextResponse.json({ id: inserted.id, error: 'LINE送信に失敗しました' }, { status: 502 })
  }
}
