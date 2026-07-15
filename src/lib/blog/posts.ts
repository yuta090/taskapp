import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CtaBlockData } from '@/components/blog/CtaBlock'

export interface PublicPost {
  id: string
  slug: string
  title: string
  description: string | null
  body_md: string
  published_at: string | null
  cover_image_url: string | null
  tags: string[]
  author_name: string | null
  noindex: boolean
  inline_cta: CtaBlockData | null
  footer_cta: CtaBlockData | null
}

export interface PostListItem {
  slug: string
  title: string
  description: string | null
  published_at: string | null
  cover_image_url: string | null
  tags: string[]
}

const CTA_FIELDS = 'id, heading, body, button_label, button_url, variant, enabled'

function toCtaData(row: Record<string, unknown> | null): CtaBlockData | null {
  if (!row || row.enabled === false) return null
  return {
    heading: String(row.heading),
    body: (row.body as string) ?? null,
    button_label: String(row.button_label),
    button_url: String(row.button_url),
    variant: (row.variant as CtaBlockData['variant']) ?? 'band',
  }
}

/** 公開済み記事を slug で取得（CTAを解決して埋め込む）。非公開なら null。 */
export async function getPublishedPost(slug: string): Promise<PublicPost | null> {
  const admin = createAdminClient()
  const { data } = await (admin as SupabaseClient)
    .from('blog_posts')
    .select(
      `id, slug, title, description, body_md, status, published_at, cover_image_url, tags, author_name, noindex, inline_cta_id, footer_cta_id,
       inline_cta:cta_blocks!blog_posts_inline_cta_id_fkey(${CTA_FIELDS}),
       footer_cta:cta_blocks!blog_posts_footer_cta_id_fkey(${CTA_FIELDS})`
    )
    .eq('slug', slug)
    .single()

  if (
    !data ||
    data.status !== 'published' ||
    !data.published_at ||
    new Date(data.published_at) > new Date()
  ) {
    return null
  }

  return {
    id: data.id,
    slug: data.slug,
    title: data.title,
    description: data.description ?? null,
    body_md: data.body_md ?? '',
    published_at: data.published_at,
    cover_image_url: data.cover_image_url ?? null,
    tags: data.tags ?? [],
    author_name: data.author_name ?? null,
    noindex: data.noindex ?? false,
    inline_cta: toCtaData(Array.isArray(data.inline_cta) ? data.inline_cta[0] : data.inline_cta),
    footer_cta: toCtaData(Array.isArray(data.footer_cta) ? data.footer_cta[0] : data.footer_cta),
  }
}

/** 公開済み記事の一覧（公開日降順）。 */
export async function listPublishedPosts(): Promise<PostListItem[]> {
  const admin = createAdminClient()
  const { data } = await (admin as SupabaseClient)
    .from('blog_posts')
    .select('slug, title, description, published_at, cover_image_url, tags, status')
    .eq('status', 'published')
    .not('published_at', 'is', null)
    .lte('published_at', new Date().toISOString())
    .order('published_at', { ascending: false })
    .limit(200)

  return ((data as PostListItem[]) ?? []).map((p) => ({
    slug: p.slug,
    title: p.title,
    description: p.description ?? null,
    published_at: p.published_at,
    cover_image_url: p.cover_image_url ?? null,
    tags: p.tags ?? [],
  }))
}
