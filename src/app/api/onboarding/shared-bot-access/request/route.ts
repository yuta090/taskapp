import { NextRequest, NextResponse } from 'next/server'
import { requireInternalMember } from '@/lib/channels/authz'
import { requestSharedBotAccess } from '@/lib/channels/store'
import { notifySharedBotAccessRequested } from '@/lib/channels/sharedBotRequestNotify'
import { isValidUuid } from '@/lib/uuid'

export const runtime = 'nodejs'

/**
 * POST /api/onboarding/shared-bot-access/request — 共通LINE(共有Bot)の利用申込（none→requested）。
 *
 * org 側の self-service。冪等（既に requested/granted なら現状を返すだけ）。
 * 付与(→granted)は当社(ops・service role)の運用判断で、このAPIには無い（allow_code_only と同型）。
 * 書込は service role（store 側）で行い、org_channel_policy に書込ポリシーは付けない（アプリ境界で authz）。
 */
export async function POST(request: NextRequest) {
  let body: { orgId?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const orgId = typeof body.orgId === 'string' ? body.orgId : ''
  if (!isValidUuid(orgId)) {
    return NextResponse.json({ error: 'orgId is required' }, { status: 400 })
  }

  const auth = await requireInternalMember(orgId)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const { access, transitioned } = await requestSharedBotAccess(orgId, auth.userId)

    // 新規申込のときだけ運営(superadmin)へメールで知らせる。これが無いと
    // 「申し込んだのに誰も気づかない」で開通が止まる。再申込(transitioned=false)では
    // 送らない＝連打で運営のメールを溢れさせない。
    // ベストエフォート: 通知が失敗しても申込自体は成功として返す（記録はもう確定している）。
    if (transitioned) {
      try {
        await notifySharedBotAccessRequested({ orgId })
      } catch (err) {
        console.error('shared-bot-access/request: notify failed', orgId, err)
      }
    }

    return NextResponse.json({ access })
  } catch (error) {
    console.error('shared-bot-access/request: failed', error)
    return NextResponse.json({ error: '申し込みに失敗しました' }, { status: 500 })
  }
}
