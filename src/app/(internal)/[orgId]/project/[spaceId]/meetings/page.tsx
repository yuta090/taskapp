import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/server'
import { prefetchMeetings } from '@/lib/supabase/prefetch'
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
    await prefetchMeetings(queryClient, supabase, spaceId)
  } catch {
    // Prefetch failure is non-critical
  }

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <MeetingsPageClient orgId={orgId} spaceId={spaceId} />
    </HydrationBoundary>
  )
}
