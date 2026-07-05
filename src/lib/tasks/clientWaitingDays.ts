/** Whole days elapsed from `from` to `to` (floor of real elapsed time, not calendar-date subtraction). */
function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24))
}

/**
 * Days a task has been waiting on the client (ball === 'client'), using
 * `updated_at` as a proxy for when the ball was passed. Shared by the
 * dashboard follow-up list (staleDays) and TaskRow's "N日待ち" badge (B-4)
 * so the two views can't disagree on how stale a task is.
 */
export function getClientWaitingDays(updatedAt: string, now: Date = new Date()): number {
  return daysBetween(new Date(updatedAt), now)
}
