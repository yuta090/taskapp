import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifySuperadmin } from '@/lib/admin/verify-superadmin'
import { validateTemplateFields } from '@/lib/email/templates/core'
import { getEmailTemplateDef } from '@/lib/email/templates/registry'
import { resetEmailTemplateCache } from '@/lib/email/templates/loadEmailTemplate'

export const runtime = 'nodejs'

/**
 * PUT /api/admin/email-templates — メール文面の保存（運営専用）
 *
 * body: { key: <台帳のキー>, fields: {...} }
 *   or  { key, reset: true }  … 保存を消してコード既定に戻す
 *
 * - 門番: verifySuperadmin（運営でなければ 403）
 * - key は台帳（registry）に載っているものだけ受け付ける（DB の CHECK は形式だけ）
 * - email_templates は RLS 有効・ポリシー無し（= service role 以外は読めない書けない）。
 *   書き込みの正規経路はこの API だけ。
 * - 文面はここで検証（必須・長さ・差し込み語）。HTML の安全性は送信側のエスケープで担保。
 */
export async function PUT(request: NextRequest) {
  const adminUserId = await verifySuperadmin()
  if (!adminUserId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const { key, fields, reset } = body as { key?: unknown; fields?: unknown; reset?: unknown }
  const def = typeof key === 'string' ? getEmailTemplateDef(key) : undefined
  if (!def) {
    return NextResponse.json({ error: 'unknown template key' }, { status: 400 })
  }

  const admin = createAdminClient()

  if (reset === true) {
    const { error } = await admin.from('email_templates').delete().eq('key', def.key)
    if (error) {
      console.error('[email-templates] reset failed:', error)
      return NextResponse.json({ error: '既定に戻せませんでした' }, { status: 500 })
    }
    resetEmailTemplateCache()
    return NextResponse.json({ key: def.key, fields: def.defaults, isCustom: false, updatedAt: null })
  }

  const validation = validateTemplateFields(fields, def.placeholders.map((p) => p.name))
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 })
  }

  // timestamptz に渡す完全な時刻なので日付ずれ(toISOString禁止ルール)の対象外。
  // upsert の UPDATE 経路では列の DEFAULT now() が効かないため明示する
  const updatedAt = new Date().toISOString()
  const { error } = await admin.from('email_templates').upsert(
    {
      key: def.key,
      ...validation.fields,
      updated_by: adminUserId,
      updated_at: updatedAt,
    },
    { onConflict: 'key' },
  )
  if (error) {
    console.error('[email-templates] save failed:', error)
    return NextResponse.json({ error: '保存に失敗しました' }, { status: 500 })
  }

  resetEmailTemplateCache()
  return NextResponse.json({ key: def.key, fields: validation.fields, isCustom: true, updatedAt })
}
