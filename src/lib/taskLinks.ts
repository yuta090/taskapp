/**
 * Deep link to a task within a project space. The task detail pane is opened
 * via the `task` query param (see TasksPageClient/GanttPageClient, which both
 * read `searchParams.get('task')`) — any other param name silently fails to
 * select the task.
 */
export function buildTaskDeepLink(orgId: string, spaceId: string, taskId: string): string {
  return `/${orgId}/project/${spaceId}?task=${taskId}`
}
