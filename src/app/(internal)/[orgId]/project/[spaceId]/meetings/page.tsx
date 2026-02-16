import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/server'
import { MeetingsPageClient } from './MeetingsPageClient'
import type { SupabaseClient } from '@supabase/supabase-js'

interface Props {
  params: Promise<{
    orgId: string
    spaceId: string
  }>
}

export default async function MeetingsPage({ params }: Props) {
  const { orgId, spaceId } = await params
  const queryClient = new QueryClient()

  try {
    const supabase = await createClient() as unknown as SupabaseClient
    await queryClient.prefetchQuery({
      queryKey: ['meetings', spaceId],
      queryFn: async () => {
        const { data, error } = await supabase
          .from('meetings')
          .select('id, org_id, space_id, title, held_at, notes, status, started_at, ended_at, created_at, updated_at, created_by, updated_by, meeting_participants (*)')
          .eq('space_id', spaceId)
          .order('held_at', { ascending: false })
          .limit(50)
        if (error) throw error
        return data ?? []
      },
    })
  } catch {
    // Prefetch failure is non-critical
  }

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <MeetingsPageClient orgId={orgId} spaceId={spaceId} />
    </HydrationBoundary>
  )
}
