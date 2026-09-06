import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifySuperadmin } from '@/lib/admin/verify-superadmin'
import {
  MANUAL_ACQUISITION_CHANNELS,
  getAcquisitionChannelLabel,
  isAcquisitionChannel,
} from '@/lib/acquisition/firstTouch'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NOTE_MAX_LEN = 500

/**
 * PATCH /api/admin/organizations/[id]/acquisition — 流入経路を運営が手で登録する
 *
 * body: { channel: AcquisitionChannel, note?: string }
 *
 * - 門番: verifySuperadmin（運営でなければ 403）
 * - org_acquisition は RLS 有効・ポリシー無し（= service role 以外は読めない書けない）。
 *   手動登録の正規経路はこの API だけ。channel_source='manual' で保存し、
 *   以後の自動判定（組織作成時の RPC）は「行があれば何もしない」ので手動が潰されない。
 * - 自動で取れた元の値（utm / 参照元 / 着地ページ）は消さない（channel と note だけ更新）。
 */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const adminUserId = await verifySuperadmin()
  if (!adminUserId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id: orgId } = await context.params
  if (!UUID_RE.test(orgId)) {
    return NextResponse.json({ error: 'invalid organization id' }, { status: 400 })
  }

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const { channel, note } = body as { channel?: unknown; note?: unknown }
  if (!isAcquisitionChannel(channel) || !MANUAL_ACQUISITION_CHANNELS.includes(channel)) {
    return NextResponse.json({ error: 'unknown channel' }, { status: 400 })
  }
  if (note != null && typeof note !== 'string') {
    return NextResponse.json({ error: 'note must be a string' }, { status: 400 })
  }
  const trimmedNote = (note ?? '').trim()
  if (trimmedNote.length > NOTE_MAX_LEN) {
    return NextResponse.json({ error: `メモは${NOTE_MAX_LEN}文字以内にしてください` }, { status: 400 })
  }

  const admin = createAdminClient()
  // timestamptz に渡す完全な時刻なので日付ずれ(toISOString禁止ルール)の対象外。
  // upsert の UPDATE 経路では列の DEFAULT now() が効かないため明示する
  const updatedAt = new Date().toISOString()
  const { error } = await admin.from('org_acquisition').upsert(
    {
      org_id: orgId,
      channel,
      channel_source: 'manual',
      note: trimmedNote || null,
      updated_by: adminUserId,
      updated_at: updatedAt,
    },
    { onConflict: 'org_id' },
  )
  if (error) {
    console.error('[admin/organizations/acquisition] upsert failed:', error)
    return NextResponse.json({ error: '流入経路を保存できませんでした' }, { status: 500 })
  }

  return NextResponse.json({
    orgId,
    channel,
    channelLabel: getAcquisitionChannelLabel(channel),
    channelSource: 'manual',
    note: trimmedNote || null,
    updatedAt,
  })
}
