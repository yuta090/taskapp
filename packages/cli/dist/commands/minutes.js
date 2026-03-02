import { resolveSpaceId } from '../config.js';
import { callTool } from '../api-client.js';
import { output, outputError } from '../output.js';
export function registerMinutesCommands(program) {
    const minutes = program.command('minutes').description('Meeting minutes');
    minutes
        .command('get')
        .description('Get meeting minutes')
        .option('-s, --space-id <uuid>', 'Space UUID')
        .requiredOption('--meeting-id <id>', 'Meeting ID')
        .action(async (opts) => {
        try {
            const result = await callTool('minutes_get', {
                spaceId: resolveSpaceId(opts),
                meetingId: opts.meetingId,
            });
            output(result, program.opts().json);
        }
        catch (e) {
            outputError(e, program.opts().json);
        }
    });
    minutes
        .command('update')
        .description('Update meeting minutes (overwrite)')
        .option('-s, --space-id <uuid>', 'Space UUID')
        .requiredOption('--meeting-id <id>', 'Meeting ID')
        .requiredOption('--minutes-md <md>', 'Minutes content (Markdown)')
        .action(async (opts) => {
        try {
            const result = await callTool('minutes_update', {
                spaceId: resolveSpaceId(opts),
                meetingId: opts.meetingId,
                minutesMd: opts.minutesMd,
            });
            output(result, program.opts().json);
        }
        catch (e) {
            outputError(e, program.opts().json);
        }
    });
    minutes
        .command('append')
        .description('Append to meeting minutes')
        .option('-s, --space-id <uuid>', 'Space UUID')
        .requiredOption('--meeting-id <id>', 'Meeting ID')
        .requiredOption('--content <md>', 'Content to append (Markdown)')
        .action(async (opts) => {
        try {
            const result = await callTool('minutes_append', {
                spaceId: resolveSpaceId(opts),
                meetingId: opts.meetingId,
                content: opts.content,
            });
            output(result, program.opts().json);
        }
        catch (e) {
            outputError(e, program.opts().json);
        }
    });
}
//# sourceMappingURL=minutes.js.map