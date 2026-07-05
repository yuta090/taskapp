/**
 * Sample task creation — shared by create-with-preset route.
 *
 * Presets ship with a few sample tasks so the landing screen after onboarding
 * isn't empty ("タスクはありません"). Milestone ids are unknown until the RPC
 * has created them, so this runs after space creation and resolves
 * milestoneName -> id by querying the space's milestones.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { PresetDefinition } from './index'
import { formatDateToLocalString } from '@/lib/gantt/dateUtils'

/**
 * Insert the preset's sample tasks into a newly created space.
 * Best-effort: never throws — logs and returns the number actually created,
 * so a failure here doesn't break the (already-succeeded) space creation response.
 */
export async function createSampleTasks(
  supabase: SupabaseClient,
  preset: PresetDefinition,
  orgId: string,
  spaceId: string,
  createdBy: string,
): Promise<number> {
  if (preset.sampleTasks.length === 0) return 0

  try {
    const { data: milestoneRows, error: milestoneError } = await supabase
      .from('milestones')
      .select('id, name')
      .eq('space_id', spaceId)

    if (milestoneError) throw milestoneError

    const milestoneIdByName = new Map<string, string>(
      ((milestoneRows ?? []) as { id: string; name: string }[]).map((m) => [m.name, m.id]),
    )

    const now = new Date()
    const rows = preset.sampleTasks.map((task) => {
      let dueDate: string | null = null
      if (task.dueInDays !== undefined) {
        const due = new Date(now)
        due.setDate(due.getDate() + task.dueInDays)
        dueDate = formatDateToLocalString(due)
      }

      return {
        org_id: orgId,
        space_id: spaceId,
        milestone_id: task.milestoneName ? milestoneIdByName.get(task.milestoneName) ?? null : null,
        title: task.title,
        description: task.description,
        status: task.status,
        ball: task.ball,
        origin: 'internal' as const,
        type: 'task' as const,
        client_scope: task.clientScope,
        due_date: dueDate,
        is_sample: true,
        created_by: createdBy,
      }
    })

    const { error: insertError } = await supabase.from('tasks').insert(rows)
    if (insertError) throw insertError

    return rows.length
  } catch (err) {
    console.error('[preset] Sample task creation failed:', err)
    return 0
  }
}
