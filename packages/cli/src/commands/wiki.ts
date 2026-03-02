import { Command } from 'commander'
import { resolveSpaceId } from '../config.js'
import { callTool } from '../api-client.js'
import { output, outputError } from '../output.js'

export function registerWikiCommands(program: Command): void {
  const wiki = program.command('wiki').description('Wiki management')

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
        })
        output(result, program.opts().json)
      } catch (e) { outputError(e, program.opts().json) }
    })

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
        })
        output(result, program.opts().json)
      } catch (e) { outputError(e, program.opts().json) }
    })

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
        })
        output(result, program.opts().json)
      } catch (e) { outputError(e, program.opts().json) }
    })

  wiki
    .command('update')
    .description('Update a wiki page')
    .option('-s, --space-id <uuid>', 'Space UUID')
    .requiredOption('--page-id <id>', 'Wiki page ID')
    .option('--title <title>', 'New title')
    .option('--body <body>', 'New body (Markdown)')
    .option('--tags <tags...>', 'New tags')
    .action(async (opts) => {
      try {
        const result = await callTool('wiki_update', {
          spaceId: resolveSpaceId(opts),
          pageId: opts.pageId,
          title: opts.title,
          body: opts.body,
          tags: opts.tags,
        })
        output(result, program.opts().json)
      } catch (e) { outputError(e, program.opts().json) }
    })

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
        })
        output(result, program.opts().json)
      } catch (e) { outputError(e, program.opts().json) }
    })

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
        })
        output(result, program.opts().json)
      } catch (e) { outputError(e, program.opts().json) }
    })
}
