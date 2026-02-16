import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/server'
import { prefetchTasks, prefetchMilestones } from '@/lib/supabase/prefetch'
import { GanttPageClient } from './GanttPageClient'
import type { SupabaseClient } from '@supabase/supabase-js'

interface Props {
  params: Promise<{
    orgId: string
    spaceId: string
  }>
}

export default async function GanttPage({ params }: Props) {
  const { orgId, spaceId } = await params
  const queryClient = new QueryClient()

  try {
    const supabase = await createClient() as unknown as SupabaseClient
    await Promise.all([
      prefetchTasks(queryClient, supabase, orgId, spaceId),
      prefetchMilestones(queryClient, supabase, spaceId),
    ])
  } catch {
    // Prefetch failure is non-critical
  }

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <GanttPageClient orgId={orgId} spaceId={spaceId} />
    </HydrationBoundary>
  )
}
