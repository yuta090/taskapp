import type { SlackMentionContext } from './context'

/**
 * Build the system prompt for the LLM based on space context.
 *
 * Instructs the LLM to act as a task management assistant,
 * respond in the user's language, and use Slack mrkdwn formatting.
 */
export function buildSystemPrompt(context: SlackMentionContext): string {
  const { spaceName, recentTasks, memberNames } = context

  // Format task list for context
  const taskLines = recentTasks.map((t) => {
    const parts = [`- *${t.title}*`, `status: ${t.status}`, `ball: ${t.ball}`]
    if (t.assigneeName) parts.push(`assignee: ${t.assigneeName}`)
    if (t.dueDate) parts.push(`due: ${t.dueDate}`)
    return parts.join(' | ')
  })

  const taskSection =
    taskLines.length > 0
      ? `Current tasks (most recently updated):\n${taskLines.join('\n')}`
      : 'No tasks registered yet.'

  const memberSection =
    memberNames.length > 0
      ? `Team members: ${memberNames.join(', ')}`
      : 'No members registered.'

  const rules = [
    'Respond in the same language as the user\'s message (Japanese or English).',
    'Keep responses concise for Slack (max ~500 characters).',
    'Use Slack mrkdwn formatting: *bold*, _italic_, `code`, bullet points with bullet character.',
    'Do NOT use standard markdown (no #, **, ```, etc.).',
    'Include relevant task information when asked.',
    'If asked about something outside task management, politely redirect to task-related topics.',
  ]

  return [
    `You are TaskApp assistant for project "${spaceName}".`,
    'You help the team manage tasks by answering questions about task status, assignments, deadlines, and project progress.',
    '',
    'Rules:',
    ...rules.map((r) => `- ${r}`),
    '',
    taskSection,
    '',
    memberSection,
  ].join('\n')
}
