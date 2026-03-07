import { resolveSpaceId } from '../config.js';
import { callTool } from '../api-client.js';
import { output, outputError } from '../output.js';
export function registerSchedulingCommands(program) {
    const sched = program.command('scheduling').description('Scheduling management');
    sched
        .command('list')
        .description('List scheduling proposals')
        .option('-s, --space-id <uuid>', 'Space UUID')
        .option('--status <status>', 'Filter: open|confirmed|cancelled|expired')
        .option('--limit <n>', 'Max results', '50')
        .action(async (opts) => {
        try {
            const result = await callTool('list_scheduling_proposals', {
                spaceId: resolveSpaceId(opts),
                status: opts.status,
                limit: parseInt(opts.limit),
            });
            output(result, program.opts().json);
        }
        catch (e) {
            outputError(e, program.opts().json);
        }
    });
    sched
        .command('create')
        .description('Create a scheduling proposal (use --stdin for complex input)')
        .option('-s, --space-id <uuid>', 'Space UUID')
        .option('--stdin', 'Read JSON params from stdin')
        .action(async (opts) => {
        try {
            let rawParams;
            if (opts.stdin) {
                const chunks = [];
                for await (const chunk of process.stdin) {
                    chunks.push(chunk);
                }
                rawParams = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
                rawParams.spaceId ??= resolveSpaceId(opts);
            }
            else {
                console.error('Error: scheduling create requires --stdin with JSON input for slots/respondents.');
                console.error('Example: echo \'{"title":"Meeting","slots":[...],"respondents":[...]}\' | agentpm scheduling create --stdin');
                process.exit(1);
            }
            const result = await callTool('create_scheduling_proposal', rawParams);
            output(result, program.opts().json);
        }
        catch (e) {
            outputError(e, program.opts().json);
        }
    });
    sched
        .command('respond')
        .description('Respond to a scheduling proposal (use --stdin)')
        .option('-s, --space-id <uuid>', 'Space UUID')
        .option('--stdin', 'Read JSON params from stdin')
        .requiredOption('--proposal-id <uuid>', 'Proposal UUID')
        .action(async (opts) => {
        try {
            let rawParams;
            if (opts.stdin) {
                const chunks = [];
                for await (const chunk of process.stdin) {
                    chunks.push(chunk);
                }
                rawParams = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
                rawParams.spaceId ??= resolveSpaceId(opts);
                rawParams.proposalId ??= opts.proposalId;
            }
            else {
                console.error('Error: scheduling respond requires --stdin with JSON responses.');
                process.exit(1);
            }
            const result = await callTool('respond_to_proposal', rawParams);
            output(result, program.opts().json);
        }
        catch (e) {
            outputError(e, program.opts().json);
        }
    });
    sched
        .command('confirm')
        .description('Confirm a scheduling slot')
        .option('-s, --space-id <uuid>', 'Space UUID')
        .requiredOption('--proposal-id <uuid>', 'Proposal UUID')
        .requiredOption('--slot-id <uuid>', 'Slot UUID to confirm')
        .action(async (opts) => {
        try {
            const result = await callTool('confirm_proposal_slot', {
                spaceId: resolveSpaceId(opts),
                proposalId: opts.proposalId,
                slotId: opts.slotId,
            });
            output(result, program.opts().json);
        }
        catch (e) {
            outputError(e, program.opts().json);
        }
    });
    sched
        .command('cancel')
        .description('Cancel or extend a proposal')
        .option('-s, --space-id <uuid>', 'Space UUID')
        .requiredOption('--proposal-id <uuid>', 'Proposal UUID')
        .requiredOption('--action <action>', 'cancel|extend')
        .option('--new-expires-at <datetime>', 'New expiry (ISO8601, required for extend)')
        .action(async (opts) => {
        try {
            const result = await callTool('cancel_scheduling_proposal', {
                spaceId: resolveSpaceId(opts),
                proposalId: opts.proposalId,
                action: opts.action,
                newExpiresAt: opts.newExpiresAt,
            });
            output(result, program.opts().json);
        }
        catch (e) {
            outputError(e, program.opts().json);
        }
    });
    sched
        .command('responses')
        .description('Get proposal response status')
        .option('-s, --space-id <uuid>', 'Space UUID')
        .requiredOption('--proposal-id <uuid>', 'Proposal UUID')
        .action(async (opts) => {
        try {
            const result = await callTool('get_proposal_responses', {
                spaceId: resolveSpaceId(opts),
                proposalId: opts.proposalId,
            });
            output(result, program.opts().json);
        }
        catch (e) {
            outputError(e, program.opts().json);
        }
    });
    sched
        .command('suggest')
        .description('Suggest available time slots from Google Calendar')
        .option('-s, --space-id <uuid>', 'Space UUID')
        .requiredOption('--user-ids <ids...>', 'User UUIDs to check')
        .requiredOption('--start-date <date>', 'Start date (YYYY-MM-DD)')
        .requiredOption('--end-date <date>', 'End date (YYYY-MM-DD)')
        .option('--duration-minutes <n>', 'Duration in minutes', '60')
        .option('--business-hour-start <n>', 'Business start hour', '9')
        .option('--business-hour-end <n>', 'Business end hour', '18')
        .action(async (opts) => {
        try {
            const result = await callTool('suggest_available_slots', {
                spaceId: resolveSpaceId(opts),
                userIds: opts.userIds,
                startDate: opts.startDate,
                endDate: opts.endDate,
                durationMinutes: parseInt(opts.durationMinutes),
                businessHourStart: parseInt(opts.businessHourStart),
                businessHourEnd: parseInt(opts.businessHourEnd),
            });
            output(result, program.opts().json);
        }
        catch (e) {
            outputError(e, program.opts().json);
        }
    });
    sched
        .command('reminder')
        .description('Send reminder to unresponded users')
        .option('-s, --space-id <uuid>', 'Space UUID')
        .requiredOption('--proposal-id <uuid>', 'Proposal UUID')
        .action(async (opts) => {
        try {
            const result = await callTool('send_proposal_reminder', {
                spaceId: resolveSpaceId(opts),
                proposalId: opts.proposalId,
            });
            output(result, program.opts().json);
        }
        catch (e) {
            outputError(e, program.opts().json);
        }
    });
}
//# sourceMappingURL=scheduling.js.map