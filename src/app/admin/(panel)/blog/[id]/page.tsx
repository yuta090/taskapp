import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'
import BlogEditorClient, {
  type EditablePost,
  type CtaOption,
} from './BlogEditorClient'

export const dynamic = 'force-dynamic'

const EMPTY_POST: EditablePost = {
  id: null,
  slug: '',
  title: '',
  description: '',
  body_md: '',
  status: 'draft',
  cover_image_url: '',
  tags: [],
  author_name: '',
  inline_cta_id: null,
  footer_cta_id: null,
  noindex: false,
}

export default async function BlogEditorPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const admin = createAdminClient()

  const { data: ctas } = await (admin as SupabaseClient)
    .from('cta_blocks')
    .select('id, name, key')
    .order('name')
  const ctaOptions = (ctas as CtaOption[]) ?? []

  if (id === 'new') {
    return <BlogEditorClient initialPost={EMPTY_POST} ctaOptions={ctaOptions} />
  }

  const { data } = await (admin as SupabaseClient)
    .from('blog_posts')
    .select(
      'id, slug, title, description, body_md, status, cover_image_url, tags, author_name, inline_cta_id, footer_cta_id, noindex'
    )
    .eq('id', id)
    .single()

  if (!data) notFound()

  const post: EditablePost = {
    ...EMPTY_POST,
    ...data,
    description: data.description ?? '',
    cover_image_url: data.cover_image_url ?? '',
    author_name: data.author_name ?? '',
    tags: data.tags ?? [],
  }

  return <BlogEditorClient initialPost={post} ctaOptions={ctaOptions} />
}
