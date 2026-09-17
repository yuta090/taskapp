import { NextRequest, NextResponse } from 'next/server'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { isRemoteTool } from '@/lib/mcp/remoteTools'
import { resolveApiKey, type ResolvedKey } from '@/lib/mcp/resolveApiKey'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * リモートMCP の受け口。ChatGPT・Claude のウェブ版・Cursor などの外部チャットがここにつなぐ。
 *
 * CLI 用の /api/tools と中身（ツール）は共有するが、口としては別物。
 *   - /api/tools … 独自の JSON。社内の CLI 専用。67本すべて使える
 *   - /api/mcp  … MCP の Streamable HTTP。外部チャット向け。許可リストのツールだけ
 *
 * ⚠ AsyncLocalStorage を使うため runtime は nodejs（Edge では挙動が違う）。
 * ⚠ セッションを持たない（ステートレス）。Vercel は呼び出しごとに別のインスタンスが応答
 *    しうるので、サーバー側にセッションを溜めると次の呼び出しで見つからなくなる。
 */
export const runtime = 'nodejs'

const SERVER_INFO = { name: 'agentpm', version: '1.0.0' }

/** 認証を求めるときの返し方。つなぎ先が入口を見つけられるように WWW-Authenticate を付ける */
function unauthorized(request: NextRequest, message: string) {
  const resourceMetadata = new URL('/.well-known/oauth-protected-resource', request.nextUrl.origin).toString()
  return NextResponse.json(
    { jsonrpc: '2.0', error: { code: -32001, message } },
    {
      status: 401,
      headers: {
        'WWW-Authenticate': `Bearer realm="agentpm", resource_metadata="${resourceMetadata}"`,
      },
    },
  )
}

/** 利用記録（fire-and-forget）。失敗しても応答は止めない */
function logUsage(
  toolName: string,
  status: 'success' | 'error',
  responseMs: number,
  info: { keyId: string; orgId: string; userId: string | null; spaceId: string | null } | null,
  errorMessage?: string,
) {
  if (!info) return
  try {
    const admin = createAdminClient()
    admin
      .from('cli_usage_logs')
      .insert({
        api_key_id: info.keyId === 'dev-key' ? null : info.keyId,
        org_id: info.orgId,
        space_id: info.spaceId,
        user_id: info.userId,
        tool_name: toolName,
        status,
        error_message: errorMessage || null,
        response_ms: responseMs,
        // 口の区別。CLI と外部チャットの利用を分けて数えられるようにする
        source: 'mcp',
      })
      .then(({ error }: { error: { message: string } | null }) => {
        if (error) console.error('cli_usage_logs insert failed:', error.message)
      })
  } catch {
    // 応答を止めない
  }
}

/**
 * この呼び出しだけの MCP サーバーを組み立てる。
 * 鍵は呼び出しごとに違うので、サーバーを使い回さない（使い回すと鍵が混ざる）。
 */
interface Core {
  toolListPayload: (isAllowed?: (name: string) => boolean) => unknown[]
  dispatchToolWithContext: (
    ctx: ResolvedKey,
    tool: string,
    params: Record<string, unknown>,
    onAuthenticated?: (info: { keyId: string; orgId: string; userId: string | null; spaceId: string | null }) => void,
  ) => Promise<unknown>
}

/**
 * ツールの実装を1回だけ読み込む。
 *
 * 動的 import なのは、ビルド時に環境変数の確認が走るのを避けるため（/api/tools と同じ）。
 * ただし呼び出しごとに import すると、ツール群(67本)を毎回読み直すうえ、同時に来た呼び出しが
 * 読み込みの途中で競合する。読み込みは1回にして、その約束を使い回す。
 * ⚠ 使い回してよいのは、認証が呼び出しごとのストアに移ったから（config.ts の runWithAuthContext）。
 */
let corePromise: Promise<Core> | null = null
function loadCore(): Promise<Core> {
  if (!corePromise) {
    corePromise = (async () => {
      const [tools, dispatch] = await Promise.all([
        import('agentpm-core/dist/tools/index.js'),
        import('agentpm-core/dist/dispatch.js'),
      ])
      return { toolListPayload: tools.toolListPayload, dispatchToolWithContext: dispatch.dispatchToolWithContext } as Core
    })()
  }
  return corePromise
}

async function buildServer(ctx: ResolvedKey): Promise<Server> {
  const { toolListPayload, dispatchToolWithContext } = await loadCore()

  const server = new Server(SERVER_INFO, { capabilities: { tools: {} } })

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolListPayload(isRemoteTool),
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params
    const startedAt = Date.now()

    // 許可リストの外は、実装があっても実行しない。
    // tools/list に出していないツールを名指しで呼ばれても、ここで止める（二重の縛り）
    if (!isRemoteTool(name)) {
      return {
        content: [{ type: 'text', text: `このツールは外部チャットからは使えません: ${name}` }],
        isError: true,
      }
    }

    let authInfo: Parameters<typeof logUsage>[3] = null
    try {
      const result = await dispatchToolWithContext(ctx, name, (args || {}) as Record<string, unknown>, (info) => {
        authInfo = info
      })
      logUsage(name, 'success', Date.now() - startedAt, authInfo)
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logUsage(name, 'error', Date.now() - startedAt, authInfo, message)
      // 断りの理由（権限・引数・状態）はそのまま AI に見せる。内部の詳細は dispatch 側で伏せてある
      return { content: [{ type: 'text', text: message }], isError: true }
    }
  })

  return server
}

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return unauthorized(request, '接続の鍵がありません')
  }
  const apiKey = authHeader.slice(7).trim()
  if (apiKey.length < 10) {
    return unauthorized(request, '接続の鍵の形式が正しくありません')
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ jsonrpc: '2.0', error: { code: -32700, message: 'JSON として読めません' } }, { status: 400 })
  }

  // 鍵をここで一度確かめる。壊れた鍵のまま MCP の応答を返すと、つなぎ先が
  // 「つながった」と誤解して後続が全部失敗する
  let ctx: ResolvedKey
  try {
    ctx = await resolveApiKey(apiKey)
  } catch (error) {
    const message = error instanceof Error ? error.message : '接続の鍵を確認できません'
    return unauthorized(request, message)
  }

  const server = await buildServer(ctx)
  const transport = new WebStandardStreamableHTTPServerTransport({
    // セッションを持たない。Vercel では呼び出しごとに別インスタンスになりうる
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })

  await server.connect(transport)
  // ⚠ ここで transport/server を close しないこと。応答の本体をまだ読み出していない段階で
  // 畳むと、中身が空のまま返って「結果が undefined」になる。呼び出しごとに作った器なので、
  // 応答を返したあとは参照が切れて回収される
  return await transport.handleRequest(request, { parsedBody: body })
}

/**
 * GET（SSE の張りっぱなし）と DELETE（セッション終了）は受け付けない。
 * ステートレスなので保持する繋ぎが無い。
 */
export async function GET() {
  return NextResponse.json(
    { jsonrpc: '2.0', error: { code: -32000, message: 'この受け口は POST だけを受け付けます' } },
    { status: 405, headers: { Allow: 'POST' } },
  )
}

export async function DELETE() {
  return NextResponse.json(
    { jsonrpc: '2.0', error: { code: -32000, message: 'この受け口は POST だけを受け付けます' } },
    { status: 405, headers: { Allow: 'POST' } },
  )
}
