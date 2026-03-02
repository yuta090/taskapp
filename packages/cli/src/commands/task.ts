import { Command } from 'commander'
import { resolveSpaceId } from '../config.js'
import { callTool } from '../api-client.js'
import { output, outputError } from '../output.js'

export function registerTaskCommands(program: Command): void {
  const task = program.command('task').description('Task management')

  task
    .command('list')
    .description('List tasks')
    .option('-s, --space-id <uuid>', 'Space UUID')
    .option('--ball <side>', 'Filter: client|internal')
    .option('--status <status>', 'Filter: backlog|todo|in_progress|in_review|done|considering')
    .option('--type <type>', 'Filter: task|spec')
    .option('--client-scope <scope>', 'Filter: deliverable|internal')
    .option('--limit <n>', 'Max results', '50')
    .action(async (opts) => {
      try {
        const result = await callTool('task_list', {
          spaceId: resolveSpaceId(opts),
          ball: opts.ball,
          status: opts.status,
          type: opts.type,
          clientScope: opts.clientScope,
          limit: parseInt(opts.limit),
        })
        output(result, program.opts().json)
      } catch (e) { outputError(e, program.opts().json) }
    })

  task
    .command('create')
    .description('Create a task')
    .option('-s, --space-id <uuid>', 'Space UUID')
    .requiredOption('--title <title>', 'Task title')
    .option('--description <desc>', 'Task description')
    .option('--type <type>', 'task|spec', 'task')
    .option('--ball <side>', 'client|internal', 'internal')
    .option('--origin <origin>', 'client|internal', 'internal')
    .option('--client-scope <scope>', 'deliverable|internal', 'deliverable')
    .option('--client-owner-ids <ids...>', 'Client owner UUIDs')
    .option('--internal-owner-ids <ids...>', 'Internal owner UUIDs')
    .option('--due-date <date>', 'Due date (YYYY-MM-DD)')
    .option('--assignee-id <uuid>', 'Assignee UUID')
    .option('--milestone-id <uuid>', 'Milestone UUID')
    .option('--spec-path <path>', 'Spec path (required for type=spec)')
    .option('--decision-state <state>', 'considering|decided|implemented')
    .action(async (opts) => {
      try {
        const result = await callTool('task_create', {
          spaceId: resolveSpaceId(opts),
          title: opts.title,
          description: opts.description,
          type: opts.type,
          ball: opts.ball,
          origin: opts.origin,
          clientScope: opts.clientScope,
          clientOwnerIds: opts.clientOwnerIds || [],
          internalOwnerIds: opts.internalOwnerIds || [],
          dueDate: opts.dueDate,
          assigneeId: opts.assigneeId,
          milestoneId: opts.milestoneId,
          specPath: opts.specPath,
          decisionState: opts.decisionState,
        })
        output(result, program.opts().json)
      } catch (e) { outputError(e, program.opts().json) }
    })

  task
    .command('get')
    .description('Get task details')
    .option('-s, --space-id <uuid>', 'Space UUID')
    .requiredOption('--task-id <uuid>', 'Task UUID')
    .action(async (opts) => {
      try {
        const result = await callTool('task_get', {
          spaceId: resolveSpaceId(opts),
          taskId: opts.taskId,
        })
        output(result, program.opts().json)
      } catch (e) { outputError(e, program.opts().json) }
    })

  task
    .command('update')
    .description('Update a task')
    .option('-s, --space-id <uuid>', 'Space UUID')
    .requiredOption('--task-id <uuid>', 'Task UUID')
    .option('--title <title>', 'New title')
    .option('--description <desc>', 'New description')
    .option('--status <status>', 'New status')
    .option('--due-date <date>', 'New due date')
    .option('--assignee-id <uuid>', 'New assignee')
    .option('--priority <n>', 'Priority (0-3)')
    .option('--client-scope <scope>', 'deliverable|internal')
    .option('--start-date <date>', 'Start date')
    .option('--parent-task-id <uuid>', 'Parent task UUID')
    .option('--actual-hours <n>', 'Actual hours')
    .option('--milestone-id <uuid>', 'Milestone UUID')
    .action(async (opts) => {
      try {
        const result = await callTool('task_update', {
          spaceId: resolveSpaceId(opts),
          taskId: opts.taskId,
          title: opts.title,
          description: opts.description,
          status: opts.status,
          dueDate: opts.dueDate,
          assigneeId: opts.assigneeId,
          priority: opts.priority !== undefined ? parseInt(opts.priority) : undefined,
          clientScope: opts.clientScope,
          startDate: opts.startDate,
          parentTaskId: opts.parentTaskId,
          actualHours: opts.actualHours !== undefined ? parseFloat(opts.actualHours) : undefined,
          milestoneId: opts.milestoneId,
        })
        output(result, program.opts().json)
      } catch (e) { outputError(e, program.opts().json) }
    })

  task
    .command('delete')
    .description('Delete a task (dry-run by default)')
    .option('-s, --space-id <uuid>', 'Space UUID')
    .requiredOption('--task-id <uuid>', 'Task UUID')
    .option('--no-dry-run', 'Actually delete (requires --confirm-token)')
    .option('--confirm-token <token>', 'Confirmation token from dry-run')
    .action(async (opts) => {
      try {
        const result = await callTool('task_delete', {
          spaceId: resolveSpaceId(opts),
          taskId: opts.taskId,
          dryRun: opts.dryRun !== false,
          confirmToken: opts.confirmToken,
        })
        output(result, program.opts().json)
      } catch (e) { outputError(e, program.opts().json) }
    })

  task
    .command('list-my')
    .description('List my tasks across all spaces (scope=user API key required)')
    .option('--ball <side>', 'Filter: client|internal')
    .option('--status <status>', 'Filter by status')
    .option('--client-scope <scope>', 'Filter: deliverable|internal')
    .option('--limit <n>', 'Max results', '50')
    .action(async (opts) => {
      try {
        const result = await callTool('task_list_my', {
          ball: opts.ball,
          status: opts.status,
          clientScope: opts.clientScope,
          limit: parseInt(opts.limit),
        })
        output(result, program.opts().json)
      } catch (e) { outputError(e, program.opts().json) }
    })

  task
    .command('stale')
    .description('Find stale tasks')
    .option('-s, --space-id <uuid>', 'Space UUID')
    .option('--stale-days <n>', 'Days threshold', '7')
    .option('--ball <side>', 'Filter: client|internal')
    .option('--limit <n>', 'Max results', '50')
    .action(async (opts) => {
      try {
        const result = await callTool('task_stale', {
          spaceId: resolveSpaceId(opts),
          staleDays: parseInt(opts.staleDays),
          ball: opts.ball,
          limit: parseInt(opts.limit),
        })
        output(result, program.opts().json)
      } catch (e) { outputError(e, program.opts().json) }
    })
}
