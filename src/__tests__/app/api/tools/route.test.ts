import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * /api/tools — MCP tool dispatch over HTTP, authenticated via a Bearer API key.
 *
 * Security-critical: must reject requests without a well-formed Authorization
 * header before any dispatch happens, and must translate dispatch auth
 * failures (invalid/expired key) into 401 without leaking internals.
 */

class MockToolNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolNotFoundError'
  }
}

class MockZodError extends Error {
  constructor(issues: unknown[]) {
    super(JSON.stringify(issues))
    this.name = 'ZodError'
  }
}

class MockToolUserError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message)
    this.name = 'ToolUserError'
  }
}

let dispatchImpl: (apiKey: string, tool: string, params: Record<string, unknown>) => Promise<unknown>

const dispatchToolMock = vi.fn(
  (apiKey: string, tool: string, params: Record<string, unknown>) => dispatchImpl(apiKey, tool, params)
)

vi.mock('agentpm-core/dist/dispatch.js', () => ({
  dispatchTool: (...args: [string, string, Record<string, unknown>]) => dispatchToolMock(...args),
  ToolNotFoundError: MockToolNotFoundError,
}))

// Fire-and-forget usage logger reads a global auth context; keep it a no-op
// (no authContext) so it never touches the DB during route tests.
vi.mock('agentpm-core/dist/config.js', () => ({
  config: { authContext: null, spaceId: null },
}))

const { POST } = await import('@/app/api/tools/route')

function callTools(
  body: unknown,
  { authHeader = 'Bearer valid_api_key_123', raw = false }: { authHeader?: string | null; raw?: boolean } = {}
) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (authHeader !== null) headers['Authorization'] = authHeader
  const request = new NextRequest(new URL('/api/tools', 'http://localhost:3000'), {
    method: 'POST',
    headers,
    body: raw ? (body as string) : JSON.stringify(body),
  })
  return POST(request)
}

beforeEach(() => {
  vi.clearAllMocks()
  dispatchImpl = () => Promise.resolve({ ok: true })
})

describe('POST /api/tools', () => {
  it('returns 401 when the Authorization header is missing', async () => {
    const response = await callTools({ tool: 'list_tasks' }, { authHeader: null })
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toMatch(/Authorization header/)
    expect(dispatchToolMock).not.toHaveBeenCalled()
  })

  it('returns 401 when the Authorization header is not a Bearer token', async () => {
    const response = await callTools({ tool: 'list_tasks' }, { authHeader: 'Basic abc123' })

    expect(response.status).toBe(401)
    expect(dispatchToolMock).not.toHaveBeenCalled()
  })

  it('returns 401 when the bearer token is too short to be a real API key', async () => {
    const response = await callTools({ tool: 'list_tasks' }, { authHeader: 'Bearer short' })
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Invalid API key format')
    expect(dispatchToolMock).not.toHaveBeenCalled()
  })

  it('returns 400 on invalid JSON body', async () => {
    const response = await callTools('not json{', { raw: true })

    expect(response.status).toBe(400)
    expect(dispatchToolMock).not.toHaveBeenCalled()
  })

  it('returns 400 when the body is not a JSON object', async () => {
    const response = await callTools(['not', 'an', 'object'])

    expect(response.status).toBe(400)
    expect(dispatchToolMock).not.toHaveBeenCalled()
  })

  it('returns 400 when the tool field is missing', async () => {
    const response = await callTools({ params: {} })

    expect(response.status).toBe(400)
    expect(dispatchToolMock).not.toHaveBeenCalled()
  })

  it('returns 400 when params is not an object', async () => {
    const response = await callTools({ tool: 'list_tasks', params: 'nope' })

    expect(response.status).toBe(400)
    expect(dispatchToolMock).not.toHaveBeenCalled()
  })

  it('dispatches the tool with the extracted bearer key and params, returning the result', async () => {
    dispatchImpl = () => Promise.resolve({ tasks: [] })

    const response = await callTools({ tool: 'list_tasks', params: { spaceId: 'space-1' } })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({ tasks: [] })
    expect(dispatchToolMock).toHaveBeenCalledWith('valid_api_key_123', 'list_tasks', { spaceId: 'space-1' })
  })

  it('returns 401 when dispatch rejects with an invalid/expired API key error', async () => {
    dispatchImpl = () => Promise.reject(new Error('Invalid or expired API key'))

    const response = await callTools({ tool: 'list_tasks' })
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Invalid or expired API key')
  })

  it('returns 400 when dispatch rejects with ToolNotFoundError', async () => {
    dispatchImpl = () => Promise.reject(new MockToolNotFoundError('Unknown tool: bogus_tool'))

    const response = await callTools({ tool: 'bogus_tool' })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Unknown tool: bogus_tool')
  })

  it('returns 400 with parsed validation details when dispatch rejects with a ZodError', async () => {
    const issues = [{ path: ['spaceId'], message: 'Required' }]
    dispatchImpl = () => Promise.reject(new MockZodError(issues))

    const response = await callTools({ tool: 'list_tasks', params: {} })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Validation error')
    expect(data.details).toEqual(issues)
  })

  // 権限で断られた理由（鍵の操作不足・古い鍵・プロジェクト違い）が 500 に化けて CLI / AI に見えず、
  // 何を直せばよいか分からなかった（2026-09-10）。理由は決まった文言で秘密を含まないので、鍵の持ち主に返す
  it('returns 403 with the reason when dispatch rejects with a permission error', async () => {
    dispatchImpl = () => Promise.reject(new Error('権限エラー: User is not a member of this space'))

    const response = await callTools({ tool: 'task_list' })
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error).toBe('権限エラー: User is not a member of this space')
  })

  // 利用者に見せてよい理由（承認前で完了できない・鍵の種類違い・会議の作成者が無い等）が
  // 500 に化けて CLI / AI に見えなかった（2026-09-12）。ツールが決めたステータスと文言で返す
  it('returns the status and message carried by ToolUserError', async () => {
    dispatchImpl = () => Promise.reject(new MockToolUserError('レビューの承認が済んでいないため、完了にできません', 409))

    const response = await callTools({ tool: 'task_update' })
    const data = await response.json()

    expect(response.status).toBe(409)
    expect(data.error).toBe('レビューの承認が済んでいないため、完了にできません')
  })

  it('falls back to 400 when ToolUserError carries no 4xx status', async () => {
    dispatchImpl = () => Promise.reject(new MockToolUserError('理由', 500))

    const response = await callTools({ tool: 'task_update' })

    expect(response.status).toBe(400)
  })

  it('returns a generic 500 without leaking the error message or stack trace', async () => {
    dispatchImpl = () => Promise.reject(new Error('unexpected internal failure'))

    const response = await callTools({ tool: 'list_tasks' })
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Internal server error')
    expect(data.stack).toBeUndefined()
    expect(JSON.stringify(data)).not.toContain('unexpected internal failure')
  })
})
