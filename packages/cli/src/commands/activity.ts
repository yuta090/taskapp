import { Command } from 'commander'
import { resolveSpaceId } from '../config.js'
import { callTool } from '../api-client.js'
import { output, outputError } from '../output.js'

export function registerActivityCommands(program: Command): void {
  const activity = program.command('activity').description('Activity log')

  activity
    .command('search')
    .description('Search activity logs')
    .option('-s, --space-id <uuid>', 'Space UUID')
    .option('--entity-table <table>', 'Filter by table name')
    .option('--entity-id <uuid>', 'Filter by entity ID')
    .option('--actor-id <uuid>', 'Filter by actor ID')
    .option('--action <action>', 'Filter by action')
    .option('--from <datetime>', 'Start datetime (ISO8601)')
    .option('--to <datetime>', 'End datetime (ISO8601)')
    .option('--session-id <uuid>', 'Filter by session ID')
    .option('--limit <n>', 'Max results', '100')
    .action(async (opts) => {
      try {
        const result = await callTool('activity_search', {
          spaceId: resolveSpaceId(opts),
          entityTable: opts.entityTable,
          entityId: opts.entityId,
          actorId: opts.actorId,
          action: opts.action,
          from: opts.from,
          to: opts.to,
          sessionId: opts.sessionId,
          limit: parseInt(opts.limit),
        })
        output(result, program.opts().json)
      } catch (e) { outputError(e, program.opts().json) }
    })

  activity
    .command('log')
    .description('Create an activity log entry')
    .option('-s, --space-id <uuid>', 'Space UUID')
    .requiredOption('--entity-table <table>', 'Table name')
    .requiredOption('--entity-id <uuid>', 'Entity ID')
    .requiredOption('--action <action>', 'Action')
    .option('--actor-type <type>', 'user|system|ai|service', 'ai')
    .option('--actor-service <service>', 'Service name')
    .option('--entity-display <name>', 'Display name')
    .option('--reason <reason>', 'Reason')
    .option('--status <status>', 'ok|error|warning', 'ok')
    .action(async (opts) => {
      try {
        const result = await callTool('activity_log', {
          spaceId: resolveSpaceId(opts),
          entityTable: opts.entityTable,
          entityId: opts.entityId,
          action: opts.action,
          actorType: opts.actorType,
          actorService: opts.actorService,
          entityDisplay: opts.entityDisplay,
          reason: opts.reason,
          status: opts.status,
        })
        output(result, program.opts().json)
      } catch (e) { outputError(e, program.opts().json) }
    })

  activity
    .command('history')
    .description('Get entity change history')
    .requiredOption('--entity-table <table>', 'Table name')
    .requiredOption('--entity-id <uuid>', 'Entity ID')
    .option('--limit <n>', 'Max results', '50')
    .action(async (opts) => {
      try {
        const result = await callTool('activity_entity_history', {
          entityTable: opts.entityTable,
          entityId: opts.entityId,
          limit: parseInt(opts.limit),
        })
        output(result, program.opts().json)
      } catch (e) { outputError(e, program.opts().json) }
    })
}
