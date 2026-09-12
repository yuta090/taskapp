import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifySuperadmin } from '@/lib/admin/verify-superadmin'
import type { SupabaseClient } from '@supabase/supabase-js'
import BlogListClient, { type BlogRow } from './BlogListClient'

export const dynamic = 'force-dynamic'

export default async function AdminBlogPage() {
  // (panel) layout でも門番を通しているが、service role でデータを取るページなので
  // データ取得の直前でも確認する（Next.js の推奨: 認可はデータ源の近くで）。
  const currentUserId = await verifySuperadmin()
  if (!currentUserId) redirect('/admin/login')

  const admin = createAdminClient()
  const { data } = await (admin as SupabaseClient)
    .from('blog_posts')
    .select('id, slug, title, status, published_at, updated_at, noindex')
    .order('updated_at', { ascending: false })
    .limit(500)

  return <BlogListClient initialData={(data as BlogRow[]) ?? []} />
}
