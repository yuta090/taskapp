import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/server'
import { prefetchMilestones } from '@/lib/supabase/prefetch'
import { BurndownPageClient } from './BurndownPageClient'
import type { SupabaseClient } from '@supabase/supabase-js'

interface Props {
  params: Promise<{
    orgId: string
    spaceId: string
  }>
}

export default async function BurndownPage({ params }: Props) {
  const { orgId, spaceId } = await params
  const queryClient = new QueryClient()

  try {
    const supabase = await createClient() as unknown as SupabaseClient
    await prefetchMilestones(queryClient, supabase, spaceId)
  } catch {
    // Prefetch failure is non-critical
  }

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <BurndownPageClient orgId={orgId} spaceId={spaceId} />
    </HydrationBoundary>
  )
}
