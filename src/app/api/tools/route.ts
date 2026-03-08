import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

/** Fire-and-forget: log CLI command usage. Never throws. */
function logCliUsage(
  toolName: string,
  status: 'success' | 'error',
  responseMs: number,
  errorMessage?: string,
) {
  try {
    // Import config to get auth context (set by dispatchTool → initializeAuthWithApiKey)
    import('agentpm-core/dist/config.js').then(({ config }) => {
      const ctx = config.authContext
      if (!ctx) return

      const admin = createAdminClient()
      admin
        .from('cli_usage_logs')
        .insert({
          api_key_id: ctx.keyId === 'dev-key' ? null : ctx.keyId,
          org_id: ctx.orgId,
          space_id: config.spaceId || null,
          user_id: ctx.userId || null,
          tool_name: toolName,
          status,
          error_message: errorMessage || null,
          response_ms: responseMs,
        })
        .then(({ error }) => {
          if (error) console.error('cli_usage_logs insert failed:', error.message)
        })
    }).catch(() => {
      // config not available — skip logging
    })
  } catch {
    // Never block the response
  }
}

export async function POST(request: NextRequest) {
  const startTime = Date.now()
  let toolName = 'unknown'

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
    toolName = tool

    if (params !== undefined && (typeof params !== 'object' || params === null || Array.isArray(params))) {
      return NextResponse.json(
        { error: 'Field "params" must be a JSON object' },
        { status: 400 },
      )
    }

    // 3. Dispatch to MCP handler (dynamic import to avoid build-time env var check)
    const { dispatchTool } = await import('agentpm-core/dist/dispatch.js')
    const result = await dispatchTool(apiKey, tool, (params || {}) as Record<string, unknown>)

    // 4. Log usage (fire-and-forget)
    logCliUsage(toolName, 'success', Date.now() - startTime)

    return NextResponse.json(result)
  } catch (error) {
    // Log error usage (fire-and-forget)
    const errMsg = error instanceof Error ? error.message : String(error)
    logCliUsage(toolName, 'error', Date.now() - startTime, errMsg)

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

    // DEBUG: Return actual error for diagnosis (remove before production)
    const msg = error instanceof Error ? error.message : String(error)
    const stack = error instanceof Error ? error.stack?.split('\n').slice(0, 5) : undefined
    console.error('POST /api/tools error:', msg)
    return NextResponse.json({ error: msg, stack }, { status: 500 })
  }
}
