import { NextRequest, NextResponse } from 'next/server'
import { logToolUsage, type ToolAuthInfo } from '@/lib/cli-usage/logToolUsage'

/** dispatchTool がこの呼び出しで認証した鍵・組織・利用者と、実際に使われた spaceId */
type DispatchAuthInfo = ToolAuthInfo

export async function POST(request: NextRequest) {
  const startTime = Date.now()
  let toolName = 'unknown'
  let authInfo: DispatchAuthInfo | null = null

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
    const result = await dispatchTool(apiKey, tool, (params || {}) as Record<string, unknown>, (info) => {
      authInfo = info
    })

    // 4. Log usage (fire-and-forget)
    logToolUsage({ toolName, status: 'success', responseMs: Date.now() - startTime, info: authInfo, source: 'cli' })

    return NextResponse.json(result)
  } catch (error) {
    // Log error usage (fire-and-forget)。原因の詳細(error_detail)は運営画面だけで見られる
    logToolUsage({ toolName, status: 'error', responseMs: Date.now() - startTime, info: authInfo, source: 'cli', error })

    if (error instanceof Error) {
      // Auth errors
      if (error.message === 'APIキーが無効か期限切れです') {
        return NextResponse.json({ error: error.message }, { status: 401 })
      }

      // 権限で断られた（鍵の操作不足・古い鍵・プロジェクト違い・役割）。理由は mcp_authorize 等の決まった文言で
      // 秘密を含まないので、鍵の持ち主にそのまま返す。以前は 500 に化けて CLI / AI に理由が見えなかった
      if (error.message.startsWith('権限エラー:')) {
        return NextResponse.json({ error: error.message }, { status: 403 })
      }

      // Tool not found
      if (error.name === 'ToolNotFoundError') {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }

      // ツールが「呼んだ人に見せてよい」と決めた理由（承認前で完了できない・鍵の種類違い・会議の作成者が無い等）。
      // 文言は決まったもので秘密を含まない。以前は 500 に化けて CLI / AI に理由が見えなかった（2026-09-12）
      if (error.name === 'ToolUserError') {
        const status = (error as Error & { status?: unknown }).status
        const code = typeof status === 'number' && status >= 400 && status < 500 ? status : 400
        return NextResponse.json({ error: error.message }, { status: code })
      }

      // Zod validation errors
      if (error.name === 'ZodError') {
        return NextResponse.json(
          { error: 'Validation error', details: JSON.parse(error.message) },
          { status: 400 },
        )
      }
    }

    // 詳細はサーバーログのみに出力し、クライアントには汎用メッセージだけ返す
    console.error('POST /api/tools error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
