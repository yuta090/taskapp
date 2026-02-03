#!/usr/bin/env node
import { startServer } from './server.js';
startServer().catch((error) => {
    console.error('Failed to start MCP server:', error);
    process.exit(1);
});
//# sourceMappingURL=index.js.map