import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { VendorTasksClient } from './VendorTasksClient'

export default async function VendorTasksPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect('/login')
  }

  const { data: membership } = await (supabase as SupabaseClient)
    .from('space_memberships')
    .select(`
      space_id,
      spaces!inner (
        id,
        name,
        org_id,
        agency_mode
      )
    `)
    .eq('user_id', user.id)
    .eq('role', 'vendor')
    .eq('spaces.agency_mode', true)
    .limit(1)
    .single()

  if (!membership) {
    redirect('/login')
  }

  const space = membership.spaces as unknown as { id: string; name: string; org_id: string; agency_mode: boolean }

  // ベンダーに見えるタスクを取得（client_scope='deliverable' + 'internal' 両方）
  const { data: tasks } = await (supabase as SupabaseClient)
    .from('tasks')
    .select('id, title, status, ball, due_date, milestone_id, priority, created_at, updated_at')
    .eq('space_id', membership.space_id)
    .neq('status', 'done')
    .order('ball', { ascending: true }) // vendor first
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })

  return (
    <VendorTasksClient
      spaceId={membership.space_id}
      spaceName={space.name}
      orgId={space.org_id}
      tasks={tasks ?? []}
    />
  )
}
