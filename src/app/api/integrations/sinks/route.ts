import { NextRequest, NextResponse } from 'next/server'
import { requireInternalMember, requireOrgAdmin } from '@/lib/channels/authz'
import { verifyGroupInOrg } from '@/lib/channels/store'
import { isValidUuid } from '@/lib/uuid'
import { validateWebhookUrl } from '@/lib/sinks/ssrf'
import {
  createWebhookSink,
  listSinksForOrg,
  findLatestDeliveryStatusForOrg,
  ALLOWED_SINK_EVENTS,
  DEFAULT_SINK_EVENTS,
} from '@/lib/sinks/store'

export const runtime = 'nodejs'

const ALLOWED_EVENTS_SET = new Set<string>(ALLOWED_SINK_EVENTS)

/**
 * GET /api/integrations/sinks?orgId= — org のsink一覧＋直近配達状況
 *
 * 内部メンバーなら閲覧可。secret_encryptedはstore層のSELECTでも選択しない
 * （DB列レベルgrantでも二重に保護されている）。
 */
export async function GET(request: NextRequest) {
  const orgId = request.nextUrl.searchParams.get('orgId') ?? ''
  if (!isValidUuid(orgId)) {
    return NextResponse.json({ error: 'orgId is required' }, { status: 400 })
  }

  const auth = await requireInternalMember(orgId)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const [sinks, latestDeliveries] = await Promise.all([
    listSinksForOrg(orgId),
    findLatestDeliveryStatusForOrg(orgId),
  ])

  const wireSinks = sinks.map((sink) => ({
    ...sink,
    lastDelivery: latestDeliveries.get(sink.id) ?? null,
  }))

  return NextResponse.json({ sinks: wireSinks, viewerRole: auth.role })
}

interface CreateSinkBody {
  orgId?: unknown
  groupId?: unknown
  provider?: unknown
  displayName?: unknown
  config?: unknown
  events?: unknown
}

/**
 * POST /api/integrations/sinks — sink作成。owner/adminのみ。
 *
 * PR-1ではwebhookアダプタのみ実装のため provider='webhook' 以外は拒否する
 * （Notion/Google Sheetsは PR-3/PR-4 で解禁）。
 * secretは作成時に一度だけ平文で返す（以後は取得不可）。
 */
export async function POST(request: NextRequest) {
  let body: CreateSinkBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const orgId = typeof body.orgId === 'string' ? body.orgId : ''
  if (!isValidUuid(orgId)) {
    return NextResponse.json({ error: 'orgId is required' }, { status: 400 })
  }

  const auth = await requireOrgAdmin(orgId)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  if (body.provider !== 'webhook') {
    return NextResponse.json(
      { error: "provider must be 'webhook' (notion/google_sheets are not yet available)" },
      { status: 400 },
    )
  }

  const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : ''
  if (!displayName) {
    return NextResponse.json({ error: 'displayName is required' }, { status: 400 })
  }

  const groupId = typeof body.groupId === 'string' && body.groupId.length > 0 ? body.groupId : null
  if (groupId !== null) {
    if (!isValidUuid(groupId)) {
      return NextResponse.json({ error: 'groupId is invalid' }, { status: 400 })
    }
    const group = await verifyGroupInOrg(orgId, groupId)
    if (!group) {
      return NextResponse.json({ error: 'group not found' }, { status: 404 })
    }
  }

  const config = body.config as Record<string, unknown> | undefined
  const url = config && typeof config.url === 'string' ? config.url : ''
  if (!url) {
    return NextResponse.json({ error: 'config.url is required' }, { status: 400 })
  }

  const validation = await validateWebhookUrl(url)
  if (!validation.ok) {
    return NextResponse.json({ error: `invalid webhook url: ${validation.reason}` }, { status: 400 })
  }

  let events: string[] = [...DEFAULT_SINK_EVENTS]
  if (body.events !== undefined) {
    if (!Array.isArray(body.events) || !body.events.every((e) => typeof e === 'string')) {
      return NextResponse.json({ error: 'events must be an array of strings' }, { status: 400 })
    }
    if (body.events.length === 0 || !body.events.every((e) => ALLOWED_EVENTS_SET.has(e))) {
      return NextResponse.json(
        { error: `events must be a non-empty subset of ${[...ALLOWED_SINK_EVENTS].join(', ')}` },
        { status: 400 },
      )
    }
    events = body.events
  }

  const { sink, secret } = await createWebhookSink({
    orgId,
    groupId,
    displayName,
    url,
    events,
    createdBy: auth.userId,
  })

  return NextResponse.json({ sink, secret }, { status: 201 })
}
