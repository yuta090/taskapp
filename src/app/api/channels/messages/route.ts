import { NextRequest, NextResponse } from 'next/server'
import { requireInternalMember } from '@/lib/channels/authz'
import {
  findActiveIdentityForSpace,
  findLineAccountForOrg,
  insertChannelMessage,
  updateChannelMessageStatus,
  verifyGroupInOrg,
  type InsertChannelMessageInput,
} from '@/lib/channels/store'
import { pushLineMessage } from '@/lib/channels/line/client'
import { isValidUuid } from '@/lib/uuid'

export const runtime = 'nodejs'

/** LINEのテキスト上限は5000文字 */
const MAX_TEXT_LENGTH = 5000

/**
 * POST /api/channels/messages — 秘書名義の送信（WoZ期の送信UI用）
 *
 * spaceId（1対1）またはgroupId（グループ宛て）のいずれか一方を指定する。
 * groupIdはサーバ側でorgId配下かつstatus='active'であることを検証する。
 * 証跡が先、送信が後: queuedで記録 → LINE push → sent/failed 更新。
 * retryKey に行idを使い、再試行してもLINE側で二重配信されない。
 */
export async function POST(request: NextRequest) {
  let body: { orgId?: unknown; spaceId?: unknown; groupId?: unknown; text?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const orgId = typeof body.orgId === 'string' ? body.orgId : ''
  const spaceId = typeof body.spaceId === 'string' ? body.spaceId : ''
  const groupId = typeof body.groupId === 'string' ? body.groupId : ''
  const text = typeof body.text === 'string' ? body.text.trim() : ''

  if (!isValidUuid(orgId)) {
    return NextResponse.json({ error: 'orgId is required' }, { status: 400 })
  }
  if (!spaceId && !groupId) {
    return NextResponse.json({ error: 'spaceId or groupId is required' }, { status: 400 })
  }
  if (spaceId && groupId) {
    return NextResponse.json({ error: 'specify only one of spaceId or groupId' }, { status: 400 })
  }
  if (spaceId && !isValidUuid(spaceId)) {
    return NextResponse.json({ error: 'invalid spaceId' }, { status: 400 })
  }
  if (groupId && !isValidUuid(groupId)) {
    return NextResponse.json({ error: 'invalid groupId' }, { status: 400 })
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

  if (groupId) {
    return sendToGroup({ orgId, groupId, text, sentBy: auth.userId })
  }
  return sendToSpace({ orgId, spaceId, text, sentBy: auth.userId })
}

async function sendToSpace(params: {
  orgId: string
  spaceId: string
  text: string
  sentBy: string
}): Promise<NextResponse> {
  const { orgId, spaceId, text, sentBy } = params

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

  return sendAndRecord(
    {
      orgId,
      spaceId,
      identityId: identity.id,
      accountId: account.id,
      groupId: null,
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
      sentBy,
    },
    account.accessToken,
    identity.externalId,
  )
}

async function sendToGroup(params: {
  orgId: string
  groupId: string
  text: string
  sentBy: string
}): Promise<NextResponse> {
  const { orgId, groupId, text, sentBy } = params

  const group = await verifyGroupInOrg(orgId, groupId)
  if (!group || group.status !== 'active') {
    return NextResponse.json({ error: 'group not found' }, { status: 404 })
  }

  const account = await findLineAccountForOrg(orgId)
  if (!account) {
    return NextResponse.json(
      { error: 'この事務所のLINEアカウントが未設定です' },
      { status: 409 },
    )
  }

  return sendAndRecord(
    {
      orgId,
      spaceId: group.spaceId,
      identityId: null,
      accountId: account.id,
      groupId: group.id,
      channel: 'line',
      direction: 'outbound',
      actor: 'secretary',
      externalUserId: null,
      externalMessageId: null,
      contentType: 'text',
      body: text,
      payload: {},
      storagePath: null,
      status: 'queued',
      error: null,
      occurredAt: new Date().toISOString(),
      sentBy,
    },
    account.accessToken,
    group.externalGroupId,
  )
}

async function sendAndRecord(
  record: InsertChannelMessageInput,
  accessToken: string,
  pushTo: string,
): Promise<NextResponse> {
  const inserted = await insertChannelMessage(record)

  if (inserted === 'duplicate') {
    return NextResponse.json({ error: 'duplicate message' }, { status: 409 })
  }

  try {
    await pushLineMessage({
      accessToken,
      to: pushTo,
      messages: [{ type: 'text', text: record.body ?? '' }],
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
