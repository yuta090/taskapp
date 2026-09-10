import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Command } from 'commander'
import type { Manifest } from './manifest-validator.js'

/**
 * task list --offset。limit は上限100で、200件あるプロジェクトでも「続きから取る」手段が無く
 * 全件取得できなかった。CLI 側は manifest だけでコマンドを組み立てるので、offset が int として
 * 正しく params に渡ることをこの経路で確かめる。
 */
const mockCallTool = vi.fn().mockResolvedValue([])
vi.mock('./api-client.js', () => ({ callTool: (...args: unknown[]) => mockCallTool(...args) }))
vi.mock('./output.js', () => ({ output: vi.fn(), outputError: vi.fn() }))
vi.mock('./config.js', () => ({ resolveSpaceId: (o: { spaceId?: string }) => o.spaceId }))

const { registerDynamicCommands } = await import('./dynamic-loader.js')

const manifest: Manifest = {
  version: 'test',
  minCliVersion: '0.0.0',
  generatedAt: '1970-01-01T00:00:00Z',
  checksum: '',
  notices: [],
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
            { flags: '-s, --space-id <uuid>', description: 'Space UUID', param: 'spaceId', resolve: 'spaceId' },
            { flags: '--limit <n>', description: 'Max results', param: 'limit', type: 'int', default: '50' },
            { flags: '--offset <n>', description: 'Skip the first n results', param: 'offset', type: 'int', default: '0' },
          ],
        },
      ],
    },
  ],
}

function run(args: string[]) {
  const program = new Command()
  program.exitOverride()
  program.option('--json')
  registerDynamicCommands(program, manifest)
  return program.parseAsync(args, { from: 'user' })
}

const base = ['task', 'list', '--space-id', 'space-1']

describe('manifest 経由の task list --offset', () => {
  beforeEach(() => mockCallTool.mockClear())

  it('--offset 100 --limit 100 を int として渡す', async () => {
    await run([...base, '--limit', '100', '--offset', '100'])
    expect(mockCallTool).toHaveBeenCalledWith(
      'task_list',
      expect.objectContaining({ spaceId: 'space-1', limit: 100, offset: 100 })
    )
  })

  it('--offset を省略すると既定の 0 が渡る', async () => {
    await run(base)
    expect(mockCallTool).toHaveBeenCalledWith(
      'task_list',
      expect.objectContaining({ offset: 0 })
    )
  })
})
