import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/server'
import { prefetchTasks, prefetchMilestones, prefetchSpaceName } from '@/lib/supabase/prefetch'
import { TasksPageClient } from './TasksPageClient'
import type { SupabaseClient } from '@supabase/supabase-js'

interface Props {
  params: Promise<{
    orgId: string
    spaceId: string
  }>
}

export default async function TasksPage({ params }: Props) {
  const { orgId, spaceId } = await params
  const queryClient = new QueryClient()

  try {
    const supabase = await createClient() as unknown as SupabaseClient
    await Promise.all([
      prefetchTasks(queryClient, supabase, orgId, spaceId),
      prefetchMilestones(queryClient, supabase, spaceId),
      prefetchSpaceName(queryClient, supabase, spaceId),
    ])
  } catch {
    // Prefetch failure is non-critical — client hooks will re-fetch
  }

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <TasksPageClient orgId={orgId} spaceId={spaceId} />
    </HydrationBoundary>
  )
}
