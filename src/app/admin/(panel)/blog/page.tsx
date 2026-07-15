import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'
import BlogListClient, { type BlogRow } from './BlogListClient'

export const dynamic = 'force-dynamic'

export default async function AdminBlogPage() {
  const admin = createAdminClient()
  const { data } = await (admin as SupabaseClient)
    .from('blog_posts')
    .select('id, slug, title, status, published_at, updated_at, noindex')
    .order('updated_at', { ascending: false })
    .limit(500)

  return <BlogListClient initialData={(data as BlogRow[]) ?? []} />
}
