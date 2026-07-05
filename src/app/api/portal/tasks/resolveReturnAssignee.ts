import type { SupabaseClient } from '@supabase/supabase-js'

export interface ResolveReturnAssigneeParams {
  spaceId: string
  assigneeId: string | null
  createdBy: string | null
}

/**
 * When a client requests changes, the ball returns to the internal side.
 * `assignee_id` may currently point at the client reviewer (it is reused as
 * "who is acting on the task" while ball='client'), which leaves the task
 * without a usable internal owner once it bounces back. Fall back to the
 * task's creator (an internal member) whenever the current assignee is
 * unset or is not an internal space member.
 */
export async function resolveReturnAssignee(
  supabase: SupabaseClient,
  { spaceId, assigneeId, createdBy }: ResolveReturnAssigneeParams,
): Promise<string | null> {
  if (!assigneeId) return createdBy

  const { data: membership } = await (supabase as SupabaseClient)
    .from('space_memberships')
    .select('role')
    .eq('space_id', spaceId)
    .eq('user_id', assigneeId)
    .maybeSingle()

  const isInternal = !!membership && membership.role !== 'client'
  return isInternal ? assigneeId : createdBy
}
