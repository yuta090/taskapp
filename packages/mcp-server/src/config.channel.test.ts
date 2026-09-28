import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * resolveAuthContext / resolveAuthContextFromOAuthToken / dispatchTool の channel 引数。
 * CLI(/api/tools) は既定 'cli'、リモートMCP(/api/mcp) は resolveApiKey.ts が
 * 明示的に 'mcp' を渡す。stdio(1プロセス1利用者) は initializeAuth が 'stdio' を渡す。
 */

const ROW = {
  key_id: 'kid-1',
  user_id: 'user-1',
  org_id: 'org-1',
  scope: 'org',
  allowed_space_ids: null,
  allowed_actions: ['read', 'write'],
  space_id: null,
}

let rpcCalls: { fn: string; args: unknown }[] = []
let seenChannel: string | undefined

vi.mock('./supabase/client.js', () => ({
  getSupabaseClient: () => ({
    rpc: async (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args })
      return { data: [ROW], error: null }
    },
  }),
}))

vi.mock('./tools/index.js', () => ({
  allTools: [
    {
      name: 'fake_tool',
      inputSchema: { parse: (p: unknown) => p },
      handler: async () => {
        const { getAuthContext } = await import('./config.js')
        seenChannel = getAuthContext().channel
        return { ok: true }
      },
    },
  ],
}))

beforeEach(() => {
  rpcCalls = []
  seenChannel = undefined
})

describe('resolveAuthContext — channel', () => {
  it('引数を渡さなければ既定は cli（CLI 用の /api/tools はここを経由する）', async () => {
    const { resolveAuthContext } = await import('./config.js')
    const ctx = await resolveAuthContext('some-api-key')
    expect(ctx.channel).toBe('cli')
  })

  it('明示的に渡した channel をそのまま使う', async () => {
    const { resolveAuthContext } = await import('./config.js')
    const ctx = await resolveAuthContext('some-api-key', 'stdio')
    expect(ctx.channel).toBe('stdio')
  })
})

describe('resolveAuthContextFromOAuthToken — channel', () => {
  it('引数を渡さなければ既定は mcp（OAuth の合鍵は /api/mcp からしか通らない）', async () => {
    const { resolveAuthContextFromOAuthToken } = await import('./config.js')
    const ctx = await resolveAuthContextFromOAuthToken('hashed-token')
    expect(ctx.channel).toBe('mcp')
  })
})

describe('dispatchTool — channel の既定と伝搬', () => {
  it('channel を渡さなければ既定は cli で、ツール実行中の ctx にも反映される', async () => {
    const { dispatchTool } = await import('./dispatch.js')
    await dispatchTool('some-api-key', 'fake_tool', {})
    expect(seenChannel).toBe('cli')
  })

  it('channel を渡せばそれがツール実行中の ctx に反映される', async () => {
    const { dispatchTool } = await import('./dispatch.js')
    await dispatchTool('some-api-key', 'fake_tool', {}, undefined, 'stdio')
    expect(seenChannel).toBe('stdio')
  })
})
