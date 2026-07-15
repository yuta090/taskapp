import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'
import CtaListClient, { type CtaRow } from './CtaListClient'

export const dynamic = 'force-dynamic'

export default async function AdminBlogCtaPage() {
  const admin = createAdminClient()
  const { data } = await (admin as SupabaseClient)
    .from('cta_blocks')
    .select('id, key, name, heading, body, button_label, button_url, variant, enabled, updated_at')
    .order('name')

  return <CtaListClient initialData={(data as CtaRow[]) ?? []} />
}
