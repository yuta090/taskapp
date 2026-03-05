import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { AdminSidebar } from '@/components/admin/AdminSidebar'

export const dynamic = 'force-dynamic'

async function verifySuperadmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return null

  const { data: profile } = await (supabase as SupabaseClient)
    .from('profiles')
    .select('is_superadmin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_superadmin) return null

  return user
}

async function fetchUnreadNotificationCount(): Promise<number> {
  const admin = createAdminClient()
  const { count } = await admin
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .is('read_at', null)
  return count ?? 0
}

export default async function AdminPanelLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await verifySuperadmin()

  if (!user) {
    redirect('/admin/login')
  }

  const unreadCount = await fetchUnreadNotificationCount()

  return (
    <div className="flex h-screen bg-gray-50">
      <AdminSidebar unreadCount={unreadCount} />
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  )
}
