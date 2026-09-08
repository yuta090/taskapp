import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Command } from 'commander'

/**
 * `agentpm wiki update` に --parent-id / --milestone-id / --pin / --unpin を足した分。
 * commander のオプション解析から callTool の呼び出しパラメータへの変換だけを見る
 * （wiki_update 自体のサーバー側の挙動は packages/mcp-server 側のテストで確認済み）。
 */
const mockCallTool = vi.fn().mockResolvedValue({ id: 'p-1' })
vi.mock('../api-client.js', () => ({ callTool: (...args: unknown[]) => mockCallTool(...args) }))
vi.mock('../output.js', () => ({ output: vi.fn(), outputError: vi.fn() }))

const { registerWikiCommands } = await import('./wiki.js')

function buildProgram() {
  const program = new Command()
  program.exitOverride()
  program.option('--json')
  registerWikiCommands(program)
  return program
}

describe('agentpm wiki update（構造オプション）', () => {
  beforeEach(() => {
    mockCallTool.mockClear()
  })

  it('--parent-id / --milestone-id を parentPageId/milestoneId として渡す', async () => {
    const program = buildProgram()
    await program.parseAsync(
      ['wiki', 'update', '--space-id', 'space-1', '--page-id', 'p-1', '--parent-id', 'parent-1', '--milestone-id', 'm-1'],
      { from: 'user' }
    )
    expect(mockCallTool).toHaveBeenCalledWith(
      'wiki_update',
      expect.objectContaining({ pageId: 'p-1', parentPageId: 'parent-1', milestoneId: 'm-1' })
    )
  })

  it('--pin で pinned: true を渡す', async () => {
    const program = buildProgram()
    await program.parseAsync(['wiki', 'update', '--space-id', 'space-1', '--page-id', 'p-1', '--pin'], { from: 'user' })
    expect(mockCallTool).toHaveBeenCalledWith('wiki_update', expect.objectContaining({ pinned: true }))
  })

  it('--unpin で pinned: false を渡す', async () => {
    const program = buildProgram()
    await program.parseAsync(['wiki', 'update', '--space-id', 'space-1', '--page-id', 'p-1', '--unpin'], { from: 'user' })
    expect(mockCallTool).toHaveBeenCalledWith('wiki_update', expect.objectContaining({ pinned: false }))
  })

  it('--pin/--unpin/--parent-id/--milestone-id を指定しなければ pinned は undefined', async () => {
    const program = buildProgram()
    await program.parseAsync(['wiki', 'update', '--space-id', 'space-1', '--page-id', 'p-1', '--title', 'X'], { from: 'user' })
    const call = mockCallTool.mock.calls[0][1] as Record<string, unknown>
    expect(call.pinned).toBeUndefined()
    expect(call.parentPageId).toBeUndefined()
    expect(call.milestoneId).toBeUndefined()
  })
})
