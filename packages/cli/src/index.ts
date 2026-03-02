import { Command } from 'commander'
import { loadCliConfig } from './config.js'
import { registerTaskCommands } from './commands/task.js'
import { registerBallCommands } from './commands/ball.js'
import { registerMeetingCommands } from './commands/meeting.js'
import { registerReviewCommands } from './commands/review.js'
import { registerMilestoneCommands } from './commands/milestone.js'
import { registerSpaceCommands } from './commands/space.js'
import { registerActivityCommands } from './commands/activity.js'
import { registerClientCommands } from './commands/client.js'
import { registerWikiCommands } from './commands/wiki.js'
import { registerMinutesCommands } from './commands/minutes.js'
import { registerSchedulingCommands } from './commands/scheduling.js'
import { registerConfigCommand } from './commands/config-cmd.js'

const program = new Command()

program
  .name('agentpm')
  .version('0.1.0')
  .description('AgentPM CLI - AI-first task management')
  .option('--json', 'Output raw JSON')
  .option('-s, --space-id <uuid>', 'Override default space ID')
  .option('--api-key <key>', 'Override API key')
  .hook('preAction', (thisCommand, actionCommand) => {
    // Walk up to find the root command name (handles nested subcommands)
    let cmd = actionCommand
    while (cmd.parent && cmd.parent !== thisCommand) {
      cmd = cmd.parent
    }
    // config/login subcommands don't need auth
    if (cmd.name() === 'config' || cmd.name() === 'login') return

    const opts = thisCommand.opts()
    loadCliConfig({ apiKey: opts.apiKey, spaceId: opts.spaceId })
  })

registerTaskCommands(program)
registerBallCommands(program)
registerMeetingCommands(program)
registerReviewCommands(program)
registerMilestoneCommands(program)
registerSpaceCommands(program)
registerActivityCommands(program)
registerClientCommands(program)
registerWikiCommands(program)
registerMinutesCommands(program)
registerSchedulingCommands(program)
registerConfigCommand(program)

program.parseAsync()
