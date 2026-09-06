import { NextRequest, NextResponse } from 'next/server'
import { verifySuperadmin } from '@/lib/admin/verify-superadmin'
import { TEMPLATE_FIELD_KEYS, TEMPLATE_LIMITS, type TemplateFields } from '@/lib/email/templates/core'
import { isEmailTemplateKey } from '@/lib/email/templates/registry'
import { renderEmailPreview } from '@/lib/email/templates/serverPreview'

export const runtime = 'nodejs'

/**
 * POST /api/admin/email-templates/preview — 編集中の文面を見本データで描いて返す（運営専用）
 *
 * body: { key, fields }。保存はしない。入力途中でも描けるように必須/差し込み語の検証はせず、
 * 型と長さだけそろえる（文字列以外は ''、上限超えは切る）。描画は送信と同じコンポーネント。
 */
export async function POST(request: NextRequest) {
  if (!(await verifySuperadmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const { key, fields } = body as { key?: unknown; fields?: unknown }
  if (!isEmailTemplateKey(key)) {
    return NextResponse.json({ error: 'unknown template key' }, { status: 400 })
  }
  const src = (fields && typeof fields === 'object' ? fields : {}) as Record<string, unknown>
  const safe = {} as TemplateFields
  for (const k of TEMPLATE_FIELD_KEYS) {
    const v = src[k]
    safe[k] = typeof v === 'string' ? v.slice(0, TEMPLATE_LIMITS[k]) : ''
  }
  // 文面の枝葉が壊れていても常にプレビューは出す（ボタンは空だと潰れるので 1 文字入れる）
  if (!safe.cta_label) safe.cta_label = ' '

  const appName = process.env.NEXT_PUBLIC_APP_NAME || 'AgentPM'
  try {
    const rendered = await renderEmailPreview(key, safe, appName)
    if (!rendered) return NextResponse.json({ error: 'unknown template key' }, { status: 400 })
    return NextResponse.json(rendered)
  } catch (err) {
    console.error('[email-templates] preview failed:', err)
    return NextResponse.json({ error: 'プレビューを作れませんでした' }, { status: 500 })
  }
}
