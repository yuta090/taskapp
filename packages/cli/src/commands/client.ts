import { Command } from 'commander'
import { resolveSpaceId } from '../config.js'
import { callTool } from '../api-client.js'
import { output, outputError } from '../output.js'

export function registerClientCommands(program: Command): void {
  const client = program.command('client').description('Client management')

  client
    .command('list')
    .description('List clients')
    .option('-s, --space-id <uuid>', 'Filter by space UUID')
    .option('--no-include-invites', 'Exclude pending invites')
    .action(async (opts) => {
      try {
        const result = await callTool('client_list', {
          spaceId: opts.spaceId,
          includeInvites: opts.includeInvites !== false,
        })
        output(result, program.opts().json)
      } catch (e) { outputError(e, program.opts().json) }
    })

  client
    .command('get')
    .description('Get client details')
    .requiredOption('--user-id <uuid>', 'Client user UUID')
    .action(async (opts) => {
      try {
        const result = await callTool('client_get', { userId: opts.userId })
        output(result, program.opts().json)
      } catch (e) { outputError(e, program.opts().json) }
    })

  client
    .command('update')
    .description('Update client role in a space')
    .requiredOption('--user-id <uuid>', 'Client user UUID')
    .option('-s, --space-id <uuid>', 'Space UUID')
    .requiredOption('--role <role>', 'New role: client|viewer')
    .action(async (opts) => {
      try {
        const result = await callTool('client_update', {
          userId: opts.userId,
          spaceId: resolveSpaceId(opts),
          role: opts.role,
        })
        output(result, program.opts().json)
      } catch (e) { outputError(e, program.opts().json) }
    })

  client
    .command('add-to-space')
    .description('Add client to a space')
    .requiredOption('--user-id <uuid>', 'Client user UUID')
    .option('-s, --space-id <uuid>', 'Space UUID')
    .option('--role <role>', 'Role: client|viewer', 'client')
    .action(async (opts) => {
      try {
        const result = await callTool('client_add_to_space', {
          userId: opts.userId,
          spaceId: resolveSpaceId(opts),
          role: opts.role,
        })
        output(result, program.opts().json)
      } catch (e) { outputError(e, program.opts().json) }
    })

  // Invite subcommands
  const invite = client.command('invite').description('Client invitations')

  invite
    .command('create')
    .description('Create a client invite')
    .option('-s, --space-id <uuid>', 'Space UUID')
    .requiredOption('--email <email>', 'Client email')
    .option('--expires-in-days <n>', 'Expiry days', '7')
    .action(async (opts) => {
      try {
        const result = await callTool('client_invite_create', {
          email: opts.email,
          spaceId: resolveSpaceId(opts),
          expiresInDays: parseInt(opts.expiresInDays),
        })
        output(result, program.opts().json)
      } catch (e) { outputError(e, program.opts().json) }
    })

  invite
    .command('bulk-create')
    .description('Bulk create client invites')
    .option('-s, --space-id <uuid>', 'Space UUID')
    .requiredOption('--emails <emails...>', 'Client emails (max 50)')
    .option('--expires-in-days <n>', 'Expiry days', '7')
    .action(async (opts) => {
      try {
        const result = await callTool('client_invite_bulk_create', {
          emails: opts.emails,
          spaceId: resolveSpaceId(opts),
          expiresInDays: parseInt(opts.expiresInDays),
        })
        output(result, program.opts().json)
      } catch (e) { outputError(e, program.opts().json) }
    })

  invite
    .command('list')
    .description('List client invites')
    .option('-s, --space-id <uuid>', 'Filter by space')
    .option('--status <status>', 'pending|accepted|expired|all', 'pending')
    .action(async (opts) => {
      try {
        const result = await callTool('client_invite_list', {
          spaceId: opts.spaceId,
          status: opts.status,
        })
        output(result, program.opts().json)
      } catch (e) { outputError(e, program.opts().json) }
    })

  invite
    .command('resend')
    .description('Resend a client invite')
    .requiredOption('--invite-id <uuid>', 'Invite UUID')
    .option('--expires-in-days <n>', 'New expiry days', '7')
    .action(async (opts) => {
      try {
        const result = await callTool('client_invite_resend', {
          inviteId: opts.inviteId,
          expiresInDays: parseInt(opts.expiresInDays),
        })
        output(result, program.opts().json)
      } catch (e) { outputError(e, program.opts().json) }
    })
}
