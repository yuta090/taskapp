import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Command } from 'commander'
import type { Manifest } from './manifest-validator.js'

/**
 * CLI のコマンドはサーバーから配られる manifest だけで組み立てられる
 * （packages/cli/src/commands/* は配線されていない旧コード）。
 * Wiki の構造オプションが「manifest 経由でも」正しく渡ることを、この経路で確かめる。
 */
const mockCallTool = vi.fn().mockResolvedValue({ id: 'p-1' })
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
      name: 'wiki',
      description: 'Wiki management',
      subcommands: [
        {
          name: 'update',
          description: 'Update a wiki page',
          tool: 'wiki_update',
          options: [
            { flags: '-s, --space-id <uuid>', description: 'Space UUID', param: 'spaceId', resolve: 'spaceId' },
            { flags: '--page-id <id>', description: 'Wiki page ID', param: 'pageId', required: true },
            { flags: '--parent-page-id <id>', description: 'Parent page', param: 'parentPageId' },
            { flags: '--milestone-id <id>', description: 'Milestone', param: 'milestoneId' },
            { flags: '--pinned', description: 'Pin', param: 'pinned', type: 'bool' },
            { flags: '--no-pinned', description: 'Unpin', param: 'pinned', type: 'negatable' },
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

const base = ['wiki', 'update', '--space-id', 'space-1', '--page-id', 'p-1']

describe('manifest 経由の wiki update（構造オプション）', () => {
  beforeEach(() => mockCallTool.mockClear())

  it('--parent-page-id / --milestone-id をそのまま渡す', async () => {
    await run([...base, '--parent-page-id', 'parent-1', '--milestone-id', 'm-1'])
    expect(mockCallTool).toHaveBeenCalledWith(
      'wiki_update',
      expect.objectContaining({ pageId: 'p-1', parentPageId: 'parent-1', milestoneId: 'm-1' })
    )
  })

  it('--pinned で true、--no-pinned で false を渡す', async () => {
    await run([...base, '--pinned'])
    expect(mockCallTool).toHaveBeenCalledWith('wiki_update', expect.objectContaining({ pinned: true }))
    mockCallTool.mockClear()
    await run([...base, '--no-pinned'])
    expect(mockCallTool).toHaveBeenCalledWith('wiki_update', expect.objectContaining({ pinned: false }))
  })

  it('何も指定しなければ 3 つとも送らない（勝手にピン留めしない）', async () => {
    await run(base)
    const params = mockCallTool.mock.calls[0][1] as Record<string, unknown>
    expect(params.pinned).toBeUndefined()
    expect(params.parentPageId).toBeUndefined()
    expect(params.milestoneId).toBeUndefined()
  })
})
