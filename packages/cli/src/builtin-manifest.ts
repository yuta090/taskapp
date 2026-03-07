/**
 * Builtin manifest fallback.
 * Used when: no cache, server unreachable, or CLI < minCliVersion.
 * Contains a minimal subset of core commands for basic operation.
 */
import type { Manifest } from './manifest-validator.js'

const spaceOpt = {
  flags: '-s, --space-id <uuid>',
  description: 'Space UUID',
  param: 'spaceId',
  resolve: 'spaceId' as const,
}

export const BUILTIN_MANIFEST: Manifest = {
  version: '0.0.0-builtin',
  minCliVersion: '0.0.0',
  generatedAt: '1970-01-01T00:00:00Z',
  checksum: '',
  commands: [
    {
      name: 'task',
      description: 'Task management',
      subcommands: [
        {
          name: 'list',
          description: 'List tasks',
          tool: 'task_list',
          options: [
            spaceOpt,
            { flags: '--ball <side>', description: 'Filter: client|internal', param: 'ball' },
            { flags: '--status <status>', description: 'Filter by status', param: 'status' },
            { flags: '--limit <n>', description: 'Max results', param: 'limit', type: 'int', default: '50' },
          ],
        },
        {
          name: 'get',
          description: 'Get task details',
          tool: 'task_get',
          options: [
            spaceOpt,
            { flags: '--task-id <uuid>', description: 'Task UUID', param: 'taskId', required: true },
          ],
        },
        {
          name: 'create',
          description: 'Create a task',
          tool: 'task_create',
          options: [
            spaceOpt,
            { flags: '--title <title>', description: 'Task title', param: 'title', required: true },
            { flags: '--description <desc>', description: 'Description', param: 'description' },
            { flags: '--type <type>', description: 'task|spec', param: 'type', default: 'task' },
            { flags: '--ball <side>', description: 'client|internal', param: 'ball', default: 'internal' },
          ],
        },
        {
          name: 'update',
          description: 'Update a task',
          tool: 'task_update',
          options: [
            spaceOpt,
            { flags: '--task-id <uuid>', description: 'Task UUID', param: 'taskId', required: true },
            { flags: '--title <title>', description: 'New title', param: 'title' },
            { flags: '--status <status>', description: 'New status', param: 'status' },
          ],
        },
      ],
    },
    {
      name: 'ball',
      description: 'Ball ownership management',
      subcommands: [
        {
          name: 'pass',
          description: 'Pass ball ownership',
          tool: 'ball_pass',
          options: [
            spaceOpt,
            { flags: '--task-id <uuid>', description: 'Task UUID', param: 'taskId', required: true },
            { flags: '--ball <side>', description: 'New owner', param: 'ball', required: true },
          ],
        },
        {
          name: 'query',
          description: 'Query tasks by ball side',
          tool: 'ball_query',
          options: [
            spaceOpt,
            { flags: '--ball <side>', description: 'Ball side', param: 'ball', required: true },
            { flags: '--limit <n>', description: 'Max results', param: 'limit', type: 'int', default: '50' },
          ],
        },
      ],
    },
    {
      name: 'dashboard',
      description: 'Get project dashboard',
      tool: 'dashboard_get',
      options: [spaceOpt],
    },
    {
      name: 'space',
      description: 'Space management',
      subcommands: [
        {
          name: 'list',
          description: 'List spaces',
          tool: 'space_list',
          options: [],
        },
        {
          name: 'get',
          description: 'Get space details',
          tool: 'space_get',
          options: [spaceOpt],
        },
      ],
    },
  ],
}
