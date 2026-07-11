import { NextRequest, NextResponse } from 'next/server'
import { requireInternalMember, requireOrgAdmin } from '@/lib/channels/authz'
import { verifyGroupInOrg } from '@/lib/channels/store'
import { isValidUuid } from '@/lib/uuid'
import { validateWebhookUrl } from '@/lib/sinks/ssrf'
import { isValidNotionDatabaseId } from '@/lib/sinks/adapters/notion'
import {
  createWebhookSink,
  createNotionSink,
  findActiveNotionConnection,
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

  const [sinks, latestDeliveries, notionConnection] = await Promise.all([
    listSinksForOrg(orgId),
    findLatestDeliveryStatusForOrg(orgId),
    findActiveNotionConnection(orgId),
  ])

  const wireSinks = sinks.map((sink) => ({
    ...sink,
    lastDelivery: latestDeliveries.get(sink.id) ?? null,
  }))

  return NextResponse.json({
    sinks: wireSinks,
    viewerRole: auth.role,
    notionConnection: {
      connected: notionConnection !== null,
      workspaceName: notionConnection?.workspaceName ?? null,
    },
  })
}

interface CreateSinkBody {
  orgId?: unknown
  groupId?: unknown
  provider?: unknown
  displayName?: unknown
  config?: unknown
  events?: unknown
}

const CREATABLE_PROVIDERS = new Set(['webhook', 'notion'])

/**
 * POST /api/integrations/sinks — sink作成。owner/adminのみ。
 *
 * provider='webhook'|'notion'を受け付ける（google_sheetsはPR-4まで拒否）。
 * webhookのsecretは作成時に一度だけ平文で返す（以後は取得不可）。notionは
 * secretを持たない（connection_id経由でaccess_tokenを参照するためレスポンスに含めない）。
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

  if (typeof body.provider !== 'string' || !CREATABLE_PROVIDERS.has(body.provider)) {
    return NextResponse.json(
      { error: "provider must be 'webhook' or 'notion' (google_sheets is not yet available)" },
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

  const config = body.config as Record<string, unknown> | undefined

  if (body.provider === 'notion') {
    const databaseId = config && typeof config.database_id === 'string' ? config.database_id : ''
    if (!databaseId) {
      return NextResponse.json({ error: 'config.database_id is required' }, { status: 400 })
    }
    if (!isValidNotionDatabaseId(databaseId)) {
      return NextResponse.json({ error: 'config.database_id is invalid' }, { status: 400 })
    }

    const connection = await findActiveNotionConnection(orgId)
    if (!connection) {
      return NextResponse.json({ error: 'notion_not_connected' }, { status: 400 })
    }

    const sink = await createNotionSink({
      orgId,
      groupId,
      displayName,
      databaseId,
      connectionId: connection.id,
      events,
      createdBy: auth.userId,
    })

    return NextResponse.json({ sink }, { status: 201 })
  }

  const url = config && typeof config.url === 'string' ? config.url : ''
  if (!url) {
    return NextResponse.json({ error: 'config.url is required' }, { status: 400 })
  }

  const validation = await validateWebhookUrl(url)
  if (!validation.ok) {
    return NextResponse.json({ error: `invalid webhook url: ${validation.reason}` }, { status: 400 })
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
