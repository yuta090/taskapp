import { resolveSpaceId } from '../config.js';
import { callTool } from '../api-client.js';
import { output, outputError } from '../output.js';
export function registerWikiCommands(program) {
    const wiki = program.command('wiki').description('Wiki management');
    wiki
        .command('list')
        .description('List wiki pages')
        .option('-s, --space-id <uuid>', 'Space UUID')
        .option('--limit <n>', 'Max results', '50')
        .action(async (opts) => {
        try {
            const result = await callTool('wiki_list', {
                spaceId: resolveSpaceId(opts),
                limit: parseInt(opts.limit),
            });
            output(result, program.opts().json);
        }
        catch (e) {
            outputError(e, program.opts().json);
        }
    });
    wiki
        .command('get')
        .description('Get wiki page details')
        .option('-s, --space-id <uuid>', 'Space UUID')
        .requiredOption('--page-id <id>', 'Wiki page ID')
        .action(async (opts) => {
        try {
            const result = await callTool('wiki_get', {
                spaceId: resolveSpaceId(opts),
                pageId: opts.pageId,
            });
            output(result, program.opts().json);
        }
        catch (e) {
            outputError(e, program.opts().json);
        }
    });
    wiki
        .command('create')
        .description('Create a wiki page')
        .option('-s, --space-id <uuid>', 'Space UUID')
        .requiredOption('--title <title>', 'Page title')
        .option('--body <body>', 'Page body (Markdown)')
        .option('--tags <tags...>', 'Tags')
        .action(async (opts) => {
        try {
            const result = await callTool('wiki_create', {
                spaceId: resolveSpaceId(opts),
                title: opts.title,
                body: opts.body,
                tags: opts.tags,
            });
            output(result, program.opts().json);
        }
        catch (e) {
            outputError(e, program.opts().json);
        }
    });
    wiki
        .command('update')
        .description('Update a wiki page')
        .option('-s, --space-id <uuid>', 'Space UUID')
        .requiredOption('--page-id <id>', 'Wiki page ID')
        .option('--title <title>', 'New title')
        .option('--body <body>', 'New body (Markdown)')
        .option('--tags <tags...>', 'New tags')
        .option('--parent-id <id>', 'Parent page ID (folder view)')
        .option('--no-parent', 'Move the page back to the top level (clear parent)')
        .option('--milestone-id <id>', 'Milestone ID to link')
        .option('--no-milestone', 'Unlink the milestone')
        .option('--pin', 'Pin to the top of the list')
        .option('--unpin', 'Remove from the top of the list')
        .action(async (opts) => {
        try {
            if (opts.pin && opts.unpin)
                throw new Error('--pin と --unpin は同時に指定できません');
            if (opts.parentId && opts.parent === false)
                throw new Error('--parent-id と --no-parent は同時に指定できません');
            if (opts.milestoneId && opts.milestone === false)
                throw new Error('--milestone-id と --no-milestone は同時に指定できません');
            const result = await callTool('wiki_update', {
                spaceId: resolveSpaceId(opts),
                pageId: opts.pageId,
                title: opts.title,
                body: opts.body,
                tags: opts.tags,
                // commander は --no-parent を parent=false として渡す。解除は null で送る
                parentPageId: opts.parent === false ? null : opts.parentId,
                milestoneId: opts.milestone === false ? null : opts.milestoneId,
                pinned: opts.pin ? true : opts.unpin ? false : undefined,
            });
            output(result, program.opts().json);
        }
        catch (e) {
            outputError(e, program.opts().json);
        }
    });
    wiki
        .command('delete')
        .description('Delete a wiki page')
        .option('-s, --space-id <uuid>', 'Space UUID')
        .requiredOption('--page-id <id>', 'Wiki page ID')
        .action(async (opts) => {
        try {
            const result = await callTool('wiki_delete', {
                spaceId: resolveSpaceId(opts),
                pageId: opts.pageId,
            });
            output(result, program.opts().json);
        }
        catch (e) {
            outputError(e, program.opts().json);
        }
    });
    wiki
        .command('versions')
        .description('Get wiki page version history')
        .option('-s, --space-id <uuid>', 'Space UUID')
        .requiredOption('--page-id <id>', 'Wiki page ID')
        .option('--limit <n>', 'Max results', '20')
        .action(async (opts) => {
        try {
            const result = await callTool('wiki_versions', {
                spaceId: resolveSpaceId(opts),
                pageId: opts.pageId,
                limit: parseInt(opts.limit),
            });
            output(result, program.opts().json);
        }
        catch (e) {
            outputError(e, program.opts().json);
        }
    });
}
//# sourceMappingURL=wiki.js.map