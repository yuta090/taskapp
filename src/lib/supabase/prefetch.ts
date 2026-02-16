/**
 * Server-side prefetch utilities.
 *
 * Currently not used by page.tsx files (removed for faster client-side navigation),
 * but kept for potential future re-enablement on specific high-traffic pages.
 *
 * All query logic is delegated to shared functions in queries.ts
 * to prevent drift between server and client data shapes.
 */
import { QueryClient } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Milestone } from '@/types/database'
import {
  fetchTasksQuery,
  fetchMilestonesQuery,
  fetchMeetingsQuery,
  fetchSpaceNameQuery,
} from './queries'
import type { TasksQueryData, MeetingsQueryData } from './queries'

export async function prefetchTasks(
  queryClient: QueryClient,
  supabase: SupabaseClient,
  orgId: string,
  spaceId: string
) {
  await queryClient.prefetchQuery<TasksQueryData>({
    queryKey: ['tasks', orgId, spaceId],
    queryFn: () => fetchTasksQuery(supabase, orgId, spaceId),
  })
}

export async function prefetchMilestones(
  queryClient: QueryClient,
  supabase: SupabaseClient,
  spaceId: string
) {
  await queryClient.prefetchQuery<Milestone[]>({
    queryKey: ['milestones', spaceId],
    queryFn: () => fetchMilestonesQuery(supabase, spaceId),
  })
}

export async function prefetchSpaceName(
  queryClient: QueryClient,
  supabase: SupabaseClient,
  spaceId: string
) {
  await queryClient.prefetchQuery<string>({
    queryKey: ['spaceName', spaceId],
    queryFn: () => fetchSpaceNameQuery(supabase, spaceId),
  })
}

export async function prefetchMeetings(
  queryClient: QueryClient,
  supabase: SupabaseClient,
  spaceId: string
) {
  await queryClient.prefetchQuery<MeetingsQueryData>({
    queryKey: ['meetings', spaceId],
    queryFn: () => fetchMeetingsQuery(supabase, spaceId),
  })
}
