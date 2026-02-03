import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools } from './tools/index.js';
export function createMcpServer() {
    const server = new Server({
        name: 'taskapp-mcp',
        version: '0.1.0',
    }, {
        capabilities: {
            tools: {},
        },
    });
    // Register all tools
    registerTools(server);
    return server;
}
export async function startServer() {
    const server = createMcpServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    // Log to stderr (stdout is used for MCP communication)
    console.error('TaskApp MCP Server started');
    console.error('Available tools: task_create, task_update, task_list, task_get, ball_pass, ball_query, dashboard_get');
}
//# sourceMappingURL=server.js.map