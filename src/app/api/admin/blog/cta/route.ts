import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifySuperadmin } from '@/lib/admin/verify-superadmin'
import { validateCtaInput } from '@/lib/blog/validation'
import type { SupabaseClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

const CTA_FIELDS =
  'id, key, name, heading, body, button_label, button_url, variant, enabled, created_at, updated_at'

function buildCtaRow(body: Record<string, unknown>) {
  return {
    key: body.key,
    name: body.name,
    heading: body.heading,
    body: body.body ?? null,
    button_label: body.button_label,
    button_url: body.button_url,
    variant: body.variant ?? 'inline',
    enabled: body.enabled !== false,
  }
}

/** CTAブロック作成 */
export async function POST(request: NextRequest) {
  if (!(await verifySuperadmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const validation = validateCtaInput(body)
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await (admin as SupabaseClient)
    .from('cta_blocks')
    .insert(buildCtaRow(body))
    .select(CTA_FIELDS)
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'key already exists' }, { status: 409 })
    }
    console.error('cta_blocks insert failed:', error)
    return NextResponse.json({ error: 'Failed to create CTA' }, { status: 500 })
  }
  return NextResponse.json({ success: true, cta: data })
}

/** CTAブロック更新 */
export async function PATCH(request: NextRequest) {
  if (!(await verifySuperadmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || typeof body.id !== 'string') {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }
  const validation = validateCtaInput(body)
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await (admin as SupabaseClient)
    .from('cta_blocks')
    .update(buildCtaRow(body))
    .eq('id', body.id)
    .select(CTA_FIELDS)
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'key already exists' }, { status: 409 })
    }
    console.error('cta_blocks update failed:', error)
    return NextResponse.json({ error: 'Failed to update CTA' }, { status: 500 })
  }
  return NextResponse.json({ success: true, cta: data })
}

/** CTAブロック削除（記事側の参照は on delete set null で外れる） */
export async function DELETE(request: NextRequest) {
  if (!(await verifySuperadmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const id = request.nextUrl.searchParams.get('id')
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }
  const admin = createAdminClient()
  const { error } = await (admin as SupabaseClient).from('cta_blocks').delete().eq('id', id)
  if (error) {
    console.error('cta_blocks delete failed:', error)
    return NextResponse.json({ error: 'Failed to delete CTA' }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
