import { NextRequest, NextResponse } from 'next/server'

/**
 * 「この受け口(/api/mcp)は、どこで許可をもらえばいいか」の案内。
 * ChatGPT などのつなぎ先は、401 の WWW-Authenticate からここを見に来る。
 * 未ログインでも読めなければならない（publicPaths に /.well-known を入れてある）。
 */
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin
  return NextResponse.json(
    {
      resource: `${origin}/api/mcp`,
      authorization_servers: [origin],
      bearer_methods_supported: ['header'],
      resource_documentation: `${origin}/docs/manual/internal/mcp-guide`,
    },
    { headers: { 'Cache-Control': 'public, max-age=3600' } },
  )
}
