import { Command } from 'commander'
import { resolveSpaceId } from '../config.js'
import { callTool } from '../api-client.js'
import { output, outputError } from '../output.js'

export function registerReviewCommands(program: Command): void {
  const review = program.command('review').description('Review management')

  review
    .command('list')
    .description('List reviews')
    .option('-s, --space-id <uuid>', 'Space UUID')
    .option('--status <status>', 'Filter: open|approved|changes_requested')
    .option('--limit <n>', 'Max results', '20')
    .action(async (opts) => {
      try {
        const result = await callTool('review_list', {
          spaceId: resolveSpaceId(opts),
          status: opts.status,
          limit: parseInt(opts.limit),
        })
        output(result, program.opts().json)
      } catch (e) { outputError(e, program.opts().json) }
    })

  review
    .command('open')
    .description('Open a review')
    .option('-s, --space-id <uuid>', 'Space UUID')
    .requiredOption('--task-id <uuid>', 'Task UUID')
    .requiredOption('--reviewer-ids <ids...>', 'Reviewer UUIDs (1+)')
    .action(async (opts) => {
      try {
        const result = await callTool('review_open', {
          spaceId: resolveSpaceId(opts),
          taskId: opts.taskId,
          reviewerIds: opts.reviewerIds,
        })
        output(result, program.opts().json)
      } catch (e) { outputError(e, program.opts().json) }
    })

  review
    .command('approve')
    .description('Approve a review')
    .option('-s, --space-id <uuid>', 'Space UUID')
    .requiredOption('--task-id <uuid>', 'Task UUID')
    .action(async (opts) => {
      try {
        const result = await callTool('review_approve', {
          spaceId: resolveSpaceId(opts),
          taskId: opts.taskId,
        })
        output(result, program.opts().json)
      } catch (e) { outputError(e, program.opts().json) }
    })

  review
    .command('block')
    .description('Block a review (request changes)')
    .option('-s, --space-id <uuid>', 'Space UUID')
    .requiredOption('--task-id <uuid>', 'Task UUID')
    .requiredOption('--reason <reason>', 'Block reason')
    .action(async (opts) => {
      try {
        const result = await callTool('review_block', {
          spaceId: resolveSpaceId(opts),
          taskId: opts.taskId,
          reason: opts.reason,
        })
        output(result, program.opts().json)
      } catch (e) { outputError(e, program.opts().json) }
    })

  review
    .command('get')
    .description('Get review details with approvals')
    .option('-s, --space-id <uuid>', 'Space UUID')
    .requiredOption('--task-id <uuid>', 'Task UUID')
    .action(async (opts) => {
      try {
        const result = await callTool('review_get', {
          spaceId: resolveSpaceId(opts),
          taskId: opts.taskId,
        })
        output(result, program.opts().json)
      } catch (e) { outputError(e, program.opts().json) }
    })
}
