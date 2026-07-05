import { describe, it, expect } from 'vitest'
import { buildTaskDeepLink } from '@/lib/taskLinks'

describe('buildTaskDeepLink', () => {
  it('builds a link using the `task` query param, matching what TasksPageClient/GanttPageClient read', () => {
    // Regression guard: the dashboard previously linked with `?taskId=`, a
    // param name nothing on the receiving page reads (searchParams.get('task')),
    // so the deep link silently failed to select the task.
    expect(buildTaskDeepLink('org-1', 'space-1', 'task-1')).toBe(
      '/org-1/project/space-1?task=task-1'
    )
  })
})
