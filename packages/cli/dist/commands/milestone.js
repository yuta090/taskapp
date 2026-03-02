import { resolveSpaceId } from '../config.js';
import { callTool } from '../api-client.js';
import { output, outputError } from '../output.js';
export function registerMilestoneCommands(program) {
    const ms = program.command('milestone').description('Milestone management');
    ms
        .command('list')
        .description('List milestones')
        .option('-s, --space-id <uuid>', 'Space UUID')
        .action(async (opts) => {
        try {
            const result = await callTool('milestone_list', {
                spaceId: resolveSpaceId(opts),
            });
            output(result, program.opts().json);
        }
        catch (e) {
            outputError(e, program.opts().json);
        }
    });
    ms
        .command('create')
        .description('Create a milestone')
        .option('-s, --space-id <uuid>', 'Space UUID')
        .requiredOption('--name <name>', 'Milestone name')
        .option('--due-date <date>', 'Due date (YYYY-MM-DD)')
        .action(async (opts) => {
        try {
            const result = await callTool('milestone_create', {
                spaceId: resolveSpaceId(opts),
                name: opts.name,
                dueDate: opts.dueDate,
            });
            output(result, program.opts().json);
        }
        catch (e) {
            outputError(e, program.opts().json);
        }
    });
    ms
        .command('update')
        .description('Update a milestone')
        .option('-s, --space-id <uuid>', 'Space UUID')
        .requiredOption('--milestone-id <uuid>', 'Milestone UUID')
        .option('--name <name>', 'New name')
        .option('--due-date <date>', 'New due date')
        .option('--order-key <n>', 'Display order key')
        .action(async (opts) => {
        try {
            const result = await callTool('milestone_update', {
                spaceId: resolveSpaceId(opts),
                milestoneId: opts.milestoneId,
                name: opts.name,
                dueDate: opts.dueDate,
                orderKey: opts.orderKey !== undefined ? parseInt(opts.orderKey) : undefined,
            });
            output(result, program.opts().json);
        }
        catch (e) {
            outputError(e, program.opts().json);
        }
    });
    ms
        .command('get')
        .description('Get milestone details')
        .option('-s, --space-id <uuid>', 'Space UUID')
        .requiredOption('--milestone-id <uuid>', 'Milestone UUID')
        .action(async (opts) => {
        try {
            const result = await callTool('milestone_get', {
                spaceId: resolveSpaceId(opts),
                milestoneId: opts.milestoneId,
            });
            output(result, program.opts().json);
        }
        catch (e) {
            outputError(e, program.opts().json);
        }
    });
    ms
        .command('delete')
        .description('Delete a milestone')
        .option('-s, --space-id <uuid>', 'Space UUID')
        .requiredOption('--milestone-id <uuid>', 'Milestone UUID')
        .action(async (opts) => {
        try {
            const result = await callTool('milestone_delete', {
                spaceId: resolveSpaceId(opts),
                milestoneId: opts.milestoneId,
            });
            output(result, program.opts().json);
        }
        catch (e) {
            outputError(e, program.opts().json);
        }
    });
}
//# sourceMappingURL=milestone.js.map