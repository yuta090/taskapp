import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifySuperadmin } from '@/lib/admin/verify-superadmin'
import type { SupabaseClient } from '@supabase/supabase-js'
import CtaListClient, { type CtaRow } from './CtaListClient'

export const dynamic = 'force-dynamic'

export default async function AdminBlogCtaPage() {
  // (panel) layout でも門番を通しているが、service role でデータを取るページなので
  // データ取得の直前でも確認する（Next.js の推奨: 認可はデータ源の近くで）。
  const currentUserId = await verifySuperadmin()
  if (!currentUserId) redirect('/admin/login')

  const admin = createAdminClient()
  const { data } = await (admin as SupabaseClient)
    .from('cta_blocks')
    .select('id, key, name, heading, body, button_label, button_url, variant, enabled, updated_at')
    .order('name')

  return <CtaListClient initialData={(data as CtaRow[]) ?? []} />
}
