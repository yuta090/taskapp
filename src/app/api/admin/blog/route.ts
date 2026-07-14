import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifySuperadmin } from '@/lib/admin/verify-superadmin'
import { validatePostInput, type PostStatus } from '@/lib/blog/validation'
import type { SupabaseClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

const POST_FIELDS =
  'id, slug, title, description, body_md, status, published_at, cover_image_url, tags, author_name, inline_cta_id, footer_cta_id, noindex, created_at, updated_at'

/** 記事作成 */
export async function POST(request: NextRequest) {
  if (!(await verifySuperadmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const validation = validatePostInput(body)
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 })
  }

  const status = (body.status as PostStatus) ?? 'draft'
  const admin = createAdminClient()
  const { data, error } = await (admin as SupabaseClient)
    .from('blog_posts')
    .insert({
      slug: body.slug,
      title: body.title,
      description: body.description ?? null,
      body_md: body.body_md ?? '',
      status,
      // 公開時は published_at をサーバー側で自動セット（クライアントに任せない）
      published_at: status === 'published' ? new Date().toISOString() : null,
      cover_image_url: body.cover_image_url ?? null,
      tags: Array.isArray(body.tags) ? body.tags : [],
      author_name: body.author_name ?? null,
      inline_cta_id: body.inline_cta_id ?? null,
      footer_cta_id: body.footer_cta_id ?? null,
      noindex: body.noindex === true,
    })
    .select(POST_FIELDS)
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'slug already exists' }, { status: 409 })
    }
    console.error('blog_posts insert failed:', error)
    return NextResponse.json({ error: 'Failed to create post' }, { status: 500 })
  }
  return NextResponse.json({ success: true, post: data })
}

/** 記事更新 */
export async function PATCH(request: NextRequest) {
  if (!(await verifySuperadmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || typeof body.id !== 'string') {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }

  const validation = validatePostInput(body)
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 })
  }

  const admin = createAdminClient()

  // 公開へ遷移する際、まだ published_at が無ければ now() を自動セット
  const update: Record<string, unknown> = {
    slug: body.slug,
    title: body.title,
    description: body.description ?? null,
    body_md: body.body_md ?? '',
    status: body.status ?? 'draft',
    cover_image_url: body.cover_image_url ?? null,
    tags: Array.isArray(body.tags) ? body.tags : [],
    author_name: body.author_name ?? null,
    inline_cta_id: body.inline_cta_id ?? null,
    footer_cta_id: body.footer_cta_id ?? null,
    noindex: body.noindex === true,
  }
  if (body.status === 'published') {
    const { data: existing } = await (admin as SupabaseClient)
      .from('blog_posts')
      .select('published_at')
      .eq('id', body.id)
      .single()
    if (!existing?.published_at) {
      update.published_at = new Date().toISOString()
    }
  }

  const { data, error } = await (admin as SupabaseClient)
    .from('blog_posts')
    .update(update)
    .eq('id', body.id)
    .select(POST_FIELDS)
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'slug already exists' }, { status: 409 })
    }
    console.error('blog_posts update failed:', error)
    return NextResponse.json({ error: 'Failed to update post' }, { status: 500 })
  }
  return NextResponse.json({ success: true, post: data })
}

/** 記事削除 */
export async function DELETE(request: NextRequest) {
  if (!(await verifySuperadmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const id = request.nextUrl.searchParams.get('id')
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }
  const admin = createAdminClient()
  const { error } = await (admin as SupabaseClient).from('blog_posts').delete().eq('id', id)
  if (error) {
    console.error('blog_posts delete failed:', error)
    return NextResponse.json({ error: 'Failed to delete post' }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
