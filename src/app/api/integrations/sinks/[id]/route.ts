import { NextRequest, NextResponse } from 'next/server'
import { requireOrgAdmin } from '@/lib/channels/authz'
import { isValidUuid } from '@/lib/uuid'
import { validateWebhookUrl } from '@/lib/sinks/ssrf'
import { isValidNotionDatabaseId } from '@/lib/sinks/adapters/notion'
import {
  findSinkOrgId,
  findSinkMeta,
  updateSinkMeta,
  disableSink,
  reactivateSink,
  rotateWebhookSecret,
  ALLOWED_SINK_EVENTS,
} from '@/lib/sinks/store'

export const runtime = 'nodejs'

const ALLOWED_EVENTS_SET = new Set<string>(ALLOWED_SINK_EVENTS)

async function resolveOrgAndAuthorize(sinkId: string) {
  const orgId = await findSinkOrgId(sinkId)
  if (!orgId) return { ok: false as const, status: 404 as const, error: 'sink not found' }
  const auth = await requireOrgAdmin(orgId)
  if (!auth.ok) return { ok: false as const, status: auth.status, error: auth.error }
  return { ok: true as const, orgId }
}

interface PatchSinkBody {
  displayName?: unknown
  config?: unknown
  events?: unknown
  status?: unknown
  rotateSecret?: unknown
}

/**
 * PATCH /api/integrations/sinks/[id] — owner/adminのみ。
 *
 * status: 'active'への遷移(disabled/error→active)はrpc_reactivate_sinkでカウンタ・
 * スケジュールをリセットする(§2-2)。'disabled'への遷移は単純な更新。
 * rotateSecret: trueならwebhookのsecretを再生成し一度だけ平文で返す。
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: sinkId } = await params
  if (!isValidUuid(sinkId)) {
    return NextResponse.json({ error: 'invalid sink id' }, { status: 400 })
  }

  const authz = await resolveOrgAndAuthorize(sinkId)
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status })
  }

  let body: PatchSinkBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const currentSink = await findSinkMeta(sinkId)

  if (body.config !== undefined) {
    const config = body.config as Record<string, unknown>

    if (currentSink?.provider === 'notion') {
      // webhookのM1修正と同型のガード: database_idを欠くconfigの無言永続化を防ぐ。
      const databaseId = typeof config.database_id === 'string' ? config.database_id : ''
      if (!databaseId) {
        return NextResponse.json({ error: 'config.database_id is required' }, { status: 400 })
      }
      if (!isValidNotionDatabaseId(databaseId)) {
        return NextResponse.json({ error: 'config.database_id is invalid' }, { status: 400 })
      }
    } else {
      // M1修正: config を送ったのにurlを欠く(または空の)configを許すと、無言でurl無しの
      // configが永続化され、以後の配送が全部ssrf_blocked:invalid_url→deadになる。
      // configを渡す以上、webhook sinkでは常にurlを必須とする(部分マージは許可しない)。
      const url = typeof config.url === 'string' ? config.url : ''
      if (!url) {
        return NextResponse.json({ error: 'config.url is required' }, { status: 400 })
      }
      const validation = await validateWebhookUrl(url)
      if (!validation.ok) {
        return NextResponse.json({ error: `invalid webhook url: ${validation.reason}` }, { status: 400 })
      }
    }
  }

  if (body.events !== undefined) {
    if (
      !Array.isArray(body.events) ||
      body.events.length === 0 ||
      !body.events.every((e) => typeof e === 'string' && ALLOWED_EVENTS_SET.has(e))
    ) {
      return NextResponse.json(
        { error: `events must be a non-empty subset of ${[...ALLOWED_SINK_EVENTS].join(', ')}` },
        { status: 400 },
      )
    }
  }

  if (body.status !== undefined && body.status !== 'active' && body.status !== 'disabled') {
    return NextResponse.json({ error: "status must be 'active' or 'disabled'" }, { status: 400 })
  }

  if (body.status === 'active') {
    await reactivateSink(sinkId)
  } else if (body.status === 'disabled') {
    await disableSink(sinkId)
  }

  const metaUpdates: { displayName?: string; config?: Record<string, unknown>; events?: string[] } = {}
  if (typeof body.displayName === 'string') metaUpdates.displayName = body.displayName
  if (body.config !== undefined) metaUpdates.config = body.config as Record<string, unknown>
  if (Array.isArray(body.events)) metaUpdates.events = body.events as string[]

  let sink = await updateSinkMeta(sinkId, metaUpdates)

  let secret: string | undefined
  if (body.rotateSecret === true && currentSink?.provider !== 'notion') {
    const rotated = await rotateWebhookSecret(sinkId)
    if (rotated) {
      sink = rotated.sink
      secret = rotated.secret
    }
  }

  if (!sink) {
    sink = await findSinkMeta(sinkId)
  }
  if (!sink) {
    return NextResponse.json({ error: 'sink not found' }, { status: 404 })
  }

  return NextResponse.json({ sink, ...(secret ? { secret } : {}) })
}

/**
 * DELETE /api/integrations/sinks/[id] — owner/adminのみ。
 *
 * 物理DELETEはDBトリガーで禁止されている(deliveriesの証跡保護)ため、
 * status='disabled'への更新として実装する（受け入れ基準11: 削除後も配達ログが参照できる）。
 */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: sinkId } = await params
  if (!isValidUuid(sinkId)) {
    return NextResponse.json({ error: 'invalid sink id' }, { status: 400 })
  }

  const authz = await resolveOrgAndAuthorize(sinkId)
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status })
  }

  const sink = await disableSink(sinkId)
  if (!sink) {
    return NextResponse.json({ error: 'sink not found' }, { status: 404 })
  }

  return NextResponse.json({ ok: true })
}
