import { resolveSpaceId } from '../config.js';
import { callTool } from '../api-client.js';
import { output, outputError } from '../output.js';
export function registerMeetingCommands(program) {
    const meeting = program.command('meeting').description('Meeting management');
    meeting
        .command('list')
        .description('List meetings')
        .option('-s, --space-id <uuid>', 'Space UUID')
        .option('--status <status>', 'Filter: planned|in_progress|ended')
        .option('--limit <n>', 'Max results', '20')
        .action(async (opts) => {
        try {
            const result = await callTool('meeting_list', {
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
    meeting
        .command('create')
        .description('Create a meeting')
        .option('-s, --space-id <uuid>', 'Space UUID')
        .requiredOption('--title <title>', 'Meeting title')
        .option('--held-at <datetime>', 'Date/time (ISO8601)')
        .option('--notes <notes>', 'Pre-meeting notes')
        .option('--participant-ids <ids...>', 'Participant UUIDs')
        .action(async (opts) => {
        try {
            const result = await callTool('meeting_create', {
                spaceId: resolveSpaceId(opts),
                title: opts.title,
                heldAt: opts.heldAt,
                notes: opts.notes,
                participantIds: opts.participantIds || [],
            });
            output(result, program.opts().json);
        }
        catch (e) {
            outputError(e, program.opts().json);
        }
    });
    meeting
        .command('start')
        .description('Start a meeting')
        .option('-s, --space-id <uuid>', 'Space UUID')
        .requiredOption('--meeting-id <uuid>', 'Meeting UUID')
        .action(async (opts) => {
        try {
            const result = await callTool('meeting_start', {
                spaceId: resolveSpaceId(opts),
                meetingId: opts.meetingId,
            });
            output(result, program.opts().json);
        }
        catch (e) {
            outputError(e, program.opts().json);
        }
    });
    meeting
        .command('end')
        .description('End a meeting')
        .option('-s, --space-id <uuid>', 'Space UUID')
        .requiredOption('--meeting-id <uuid>', 'Meeting UUID')
        .action(async (opts) => {
        try {
            const result = await callTool('meeting_end', {
                spaceId: resolveSpaceId(opts),
                meetingId: opts.meetingId,
            });
            output(result, program.opts().json);
        }
        catch (e) {
            outputError(e, program.opts().json);
        }
    });
    meeting
        .command('get')
        .description('Get meeting details')
        .option('-s, --space-id <uuid>', 'Space UUID')
        .requiredOption('--meeting-id <uuid>', 'Meeting UUID')
        .action(async (opts) => {
        try {
            const result = await callTool('meeting_get', {
                spaceId: resolveSpaceId(opts),
                meetingId: opts.meetingId,
            });
            output(result, program.opts().json);
        }
        catch (e) {
            outputError(e, program.opts().json);
        }
    });
}
//# sourceMappingURL=meeting.js.map