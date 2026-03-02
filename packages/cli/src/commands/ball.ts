import { Command } from 'commander'
import { resolveSpaceId } from '../config.js'
import { callTool } from '../api-client.js'
import { output, outputError } from '../output.js'

export function registerBallCommands(program: Command): void {
  const ball = program.command('ball').description('Ball (ownership) management')

  ball
    .command('pass')
    .description('Pass ball ownership')
    .option('-s, --space-id <uuid>', 'Space UUID')
    .requiredOption('--task-id <uuid>', 'Task UUID')
    .requiredOption('--ball <side>', 'New ball owner: client|internal')
    .option('--client-owner-ids <ids...>', 'Client owner UUIDs')
    .option('--internal-owner-ids <ids...>', 'Internal owner UUIDs')
    .option('--reason <reason>', 'Reason for passing')
    .action(async (opts) => {
      try {
        const result = await callTool('ball_pass', {
          spaceId: resolveSpaceId(opts),
          taskId: opts.taskId,
          ball: opts.ball,
          clientOwnerIds: opts.clientOwnerIds || [],
          internalOwnerIds: opts.internalOwnerIds || [],
          reason: opts.reason,
        })
        output(result, program.opts().json)
      } catch (e) { outputError(e, program.opts().json) }
    })

  ball
    .command('query')
    .description('Query tasks by ball side')
    .option('-s, --space-id <uuid>', 'Space UUID')
    .requiredOption('--ball <side>', 'Ball side: client|internal')
    .option('--include-owners', 'Include owner info')
    .option('--limit <n>', 'Max results', '50')
    .action(async (opts) => {
      try {
        const result = await callTool('ball_query', {
          spaceId: resolveSpaceId(opts),
          ball: opts.ball,
          includeOwners: opts.includeOwners || false,
          limit: parseInt(opts.limit),
        })
        output(result, program.opts().json)
      } catch (e) { outputError(e, program.opts().json) }
    })

  // Dashboard as top-level shortcut
  program
    .command('dashboard')
    .description('Get project dashboard')
    .option('-s, --space-id <uuid>', 'Space UUID')
    .action(async (opts) => {
      try {
        const result = await callTool('dashboard_get', {
          spaceId: resolveSpaceId(opts),
        })
        output(result, program.opts().json)
      } catch (e) { outputError(e, program.opts().json) }
    })
}
