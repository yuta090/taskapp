import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { registerTools } from './tools/index.js'
import { initializeAuth } from './config.js'

export function createMcpServer(): Server {
  const server = new Server(
    {
      name: 'taskapp-mcp',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  )

  // Register all tools
  registerTools(server)

  return server
}

export async function startServer(): Promise<void> {
  const server = createMcpServer()
  const transport = new StdioServerTransport()

  await initializeAuth()
  await server.connect(transport)

  // Log to stderr (stdout is used for MCP communication)
  console.error('TaskApp MCP Server started')
  console.error('Available tools: task_*, ball_*, meeting_*, review_*, milestone_*, space_*, activity_*, client_*, wiki_*, minutes_*, scheduling_*')
}
