/** Notification types that require user action */
const ACTIONABLE_TYPES: ReadonlySet<string> = new Set([
  'review_request',
  'confirmation_request',
  'urgent_confirmation',
  'ball_passed',
  'spec_decision_needed',
  'task_assigned',
])

/** Array version for Supabase .in() queries */
export const ACTIONABLE_TYPES_ARRAY = [
  'review_request',
  'confirmation_request',
  'urgent_confirmation',
  'ball_passed',
  'spec_decision_needed',
  'task_assigned',
]

export function isActionableNotification(type: string): boolean {
  return ACTIONABLE_TYPES.has(type)
}
