import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/server'
import { prefetchMilestones } from '@/lib/supabase/prefetch'
import { WikiPageClient } from './WikiPageClient'
import type { SupabaseClient } from '@supabase/supabase-js'

interface Props {
  params: Promise<{
    orgId: string
    spaceId: string
  }>
}

export default async function WikiPage({ params }: Props) {
  const { orgId, spaceId } = await params
  const queryClient = new QueryClient()

  try {
    const supabase = await createClient() as unknown as SupabaseClient
    await Promise.all([
      queryClient.prefetchQuery({
        queryKey: ['wikiPages', orgId, spaceId],
        queryFn: async () => {
          const { data, error } = await supabase
            .from('wiki_pages')
            .select('id, org_id, space_id, title, tags, created_by, updated_by, created_at, updated_at')
            .eq('org_id', orgId)
            .eq('space_id', spaceId)
            .order('updated_at', { ascending: false })
          if (error) throw error
          return { pages: data ?? [], autoCreatedPageId: null }
        },
      }),
      prefetchMilestones(queryClient, supabase, spaceId),
    ])
  } catch {
    // Prefetch failure is non-critical
  }

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <WikiPageClient orgId={orgId} spaceId={spaceId} />
    </HydrationBoundary>
  )
}
