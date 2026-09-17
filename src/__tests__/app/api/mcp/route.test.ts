import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * /api/mcp — リモートMCPの受け口。ChatGPT などの外部チャットがここにつなぐ。
 *
 * ⚠ 公開インターネットに晒す口なので、次を必ず守る:
 *   - 鍵の無い/壊れた呼び出しは、何も実行せずに 401
 *   - tools/list は許可リストのツールだけ返す（67本の全量を出さない）
 *   - tools/call は許可リスト外を、たとえ実装が存在しても実行しない
 *   - 認証は呼び出しごと。別の鍵の呼び出しに引きずられない
 */

const dispatched: { tool: string; apiKey: string; params: Record<string, unknown> }[] = []
let dispatchImpl: (tool: string, params: Record<string, unknown>) => Promise<unknown> = async () => ({ ok: true })
let validKeys = new Set(['good-api-key-0123456789'])

vi.mock('agentpm-core/dist/dispatch.js', () => ({
  dispatchTool: async (
    apiKey: string,
    tool: string,
    params: Record<string, unknown>,
    onAuthenticated?: (i: unknown) => void,
  ) => {
    if (!validKeys.has(apiKey)) throw new Error('APIキーが無効か期限切れです')
    dispatched.push({ tool, apiKey, params })
    onAuthenticated?.({ keyId: 'kid', orgId: 'org-1', userId: 'user-1', spaceId: null })
    return dispatchImpl(tool, params)
  },
  ToolNotFoundError: class extends Error {},
}))

// 鍵の確認。route は MCP の応答を返す前に一度ここで確かめる。
// agentpm-core の config を直接モックすると、ツール群(tools/index.js)まで巻き添えになるので
// アプリ側の薄い入口だけを差し替える
vi.mock('@/lib/mcp/resolveApiKey', () => ({
  resolveApiKey: async (apiKey: string) => {
    if (!validKeys.has(apiKey)) throw new Error('APIキーが無効か期限切れです')
    return { keyId: 'kid', userId: 'user-1', orgId: 'org-1', scope: 'org', allowedSpaceIds: null, allowedActions: ['read', 'write'] }
  },
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({ insert: () => ({ then: (r: (v: { error: null }) => void) => r({ error: null }) }) }),
  }),
}))

const { POST, GET } = await import('@/app/api/mcp/route')

function rpc(body: unknown, apiKey?: string) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  }
  if (apiKey) headers.authorization = `Bearer ${apiKey}`
  return new NextRequest('https://agentpm.app/api/mcp', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

const KEY = 'good-api-key-0123456789'
const INIT = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '1.0.0' },
  },
}

/** JSON でも SSE でも、本文から JSON-RPC の結果を取り出す */
async function readRpc(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text()
  if (text.startsWith('event:') || text.includes('\ndata: ')) {
    const line = text.split('\n').find((l) => l.startsWith('data: '))
    return JSON.parse(line!.slice(6))
  }
  return JSON.parse(text)
}

beforeEach(() => {
  dispatched.length = 0
  validKeys = new Set([KEY])
  dispatchImpl = async () => ({ ok: true })
})

describe('/api/mcp — 認証', () => {
  it('Authorization が無ければ 401 で、何も実行しない', async () => {
    const res = await POST(rpc(INIT))
    expect(res.status).toBe(401)
    expect(dispatched).toEqual([])
  })

  it('401 には WWW-Authenticate を付ける（つなぎ先が入口を見つけられるように）', async () => {
    const res = await POST(rpc(INIT))
    expect(res.headers.get('WWW-Authenticate')).toMatch(/Bearer/i)
  })

  it('Bearer 以外の形式は 401', async () => {
    const req = new NextRequest('https://agentpm.app/api/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Basic abc' },
      body: JSON.stringify(INIT),
    })
    expect((await POST(req)).status).toBe(401)
  })

  it('鍵が無効なら 401 で、ツールは実行されない', async () => {
    const res = await POST(rpc({ ...INIT, method: 'tools/call', params: { name: 'task_list', arguments: {} } }, 'bad-key-0123456789'))
    expect(res.status).toBe(401)
    expect(dispatched).toEqual([])
  })
})

describe('/api/mcp — プロトコル', () => {
  it('initialize に応答し、サーバー名と tools 能力を返す', async () => {
    const res = await POST(rpc(INIT, KEY))
    expect(res.status).toBe(200)
    const body = await readRpc(res)
    const result = body.result as Record<string, unknown>
    expect(result.protocolVersion).toBeTruthy()
    expect((result.capabilities as Record<string, unknown>).tools).toBeTruthy()
    expect((result.serverInfo as Record<string, string>).name).toContain('agentpm')
  })

  it('GET（SSEの張りっぱなし）は受け付けない', async () => {
    const res = await GET()
    expect([405, 401]).toContain(res.status)
  })
})

describe('/api/mcp — ツールの絞り込み', () => {
  it('tools/list は許可リストのツールだけを返す', async () => {
    const res = await POST(rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, KEY))
    const body = await readRpc(res)
    const names = ((body.result as { tools: { name: string }[] }).tools).map((t) => t.name)

    expect(names).toContain('task_list')
    expect(names).not.toContain('task_delete')
    expect(names).not.toContain('review_approve')
    expect(names.length).toBeLessThanOrEqual(25)
  })

  it('許可リストのツールは実行され、結果が返る', async () => {
    dispatchImpl = async () => ({ tasks: [{ id: 't-1', title: 'テスト' }] })
    const res = await POST(
      rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'task_list', arguments: { spaceId: 's-1' } } }, KEY),
    )
    const body = await readRpc(res)

    expect(dispatched).toHaveLength(1)
    expect(dispatched[0].tool).toBe('task_list')
    const content = (body.result as { content: { type: string; text: string }[] }).content
    expect(JSON.parse(content[0].text)).toEqual({ tasks: [{ id: 't-1', title: 'テスト' }] })
  })

  it('許可リスト外のツールは、実装があっても実行しない', async () => {
    const res = await POST(
      rpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'task_delete', arguments: { taskId: 't-1' } } }, KEY),
    )
    const body = await readRpc(res)

    expect(dispatched).toEqual([])
    // エラーとして返す（黙って成功に見せない）
    const isError = (body.result as { isError?: boolean } | undefined)?.isError === true || body.error !== undefined
    expect(isError).toBe(true)
  })
})

describe('/api/mcp — 呼び出しごとの認証', () => {
  it('別の鍵の呼び出しが並行しても、それぞれ自分の鍵で実行される', async () => {
    validKeys = new Set([KEY, 'second-api-key-0123456789'])
    dispatchImpl = async (tool) => ({ tool })

    const call = (key: string) =>
      POST(rpc({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'task_list', arguments: {} } }, key))

    await Promise.all([call(KEY), call('second-api-key-0123456789')])

    expect(dispatched.map((d) => d.apiKey).sort()).toEqual([KEY, 'second-api-key-0123456789'].sort())
  })
})
