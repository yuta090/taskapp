import { Command } from 'commander'
import { resolveSpaceId } from '../config.js'
import { callTool } from '../api-client.js'
import { output, outputError } from '../output.js'

export function registerSpaceCommands(program: Command): void {
  const space = program.command('space').description('Space/project management')

  space
    .command('list')
    .description('List spaces')
    .option('--type <type>', 'Filter: project|personal')
    .action(async (opts) => {
      try {
        const result = await callTool('space_list', { type: opts.type })
        output(result, program.opts().json)
      } catch (e) { outputError(e, program.opts().json) }
    })

  space
    .command('create')
    .description('Create a space')
    .requiredOption('--name <name>', 'Space name')
    .option('--type <type>', 'project|personal', 'project')
    .action(async (opts) => {
      try {
        const result = await callTool('space_create', {
          name: opts.name,
          type: opts.type,
        })
        output(result, program.opts().json)
      } catch (e) { outputError(e, program.opts().json) }
    })

  space
    .command('update')
    .description('Update a space')
    .option('-s, --space-id <uuid>', 'Space UUID')
    .option('--name <name>', 'New name')
    .action(async (opts) => {
      try {
        const result = await callTool('space_update', {
          spaceId: resolveSpaceId(opts),
          name: opts.name,
        })
        output(result, program.opts().json)
      } catch (e) { outputError(e, program.opts().json) }
    })

  space
    .command('get')
    .description('Get space details')
    .option('-s, --space-id <uuid>', 'Space UUID')
    .action(async (opts) => {
      try {
        const result = await callTool('space_get', {
          spaceId: resolveSpaceId(opts),
        })
        output(result, program.opts().json)
      } catch (e) { outputError(e, program.opts().json) }
    })
}
