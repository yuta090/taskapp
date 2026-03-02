import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    // 1. Extract API key
    const authHeader = request.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Missing Authorization header. Use: Bearer <api_key>' },
        { status: 401 },
      )
    }
    const apiKey = authHeader.slice(7)
    if (!apiKey || apiKey.length < 10) {
      return NextResponse.json(
        { error: 'Invalid API key format' },
        { status: 401 },
      )
    }

    // 2. Parse and validate request body
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 },
      )
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json(
        { error: 'Request body must be a JSON object' },
        { status: 400 },
      )
    }

    const { tool, params } = body as { tool?: unknown; params?: unknown }

    if (!tool || typeof tool !== 'string') {
      return NextResponse.json(
        { error: 'Missing required field: tool (string)' },
        { status: 400 },
      )
    }

    if (params !== undefined && (typeof params !== 'object' || params === null || Array.isArray(params))) {
      return NextResponse.json(
        { error: 'Field "params" must be a JSON object' },
        { status: 400 },
      )
    }

    // 3. Dispatch to MCP handler (dynamic import to avoid build-time env var check)
    const { dispatchTool } = await import('agentpm-core/dist/dispatch.js')
    const result = await dispatchTool(apiKey, tool, (params || {}) as Record<string, unknown>)

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof Error) {
      // Auth errors
      if (error.message === 'Invalid or expired API key') {
        return NextResponse.json({ error: error.message }, { status: 401 })
      }

      // Tool not found
      if (error.name === 'ToolNotFoundError') {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }

      // Zod validation errors
      if (error.name === 'ZodError') {
        return NextResponse.json(
          { error: 'Validation error', details: JSON.parse(error.message) },
          { status: 400 },
        )
      }
    }

    // Unknown errors - don't leak internal details
    console.error('POST /api/tools error:', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
