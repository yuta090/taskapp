import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { taskTools } from './tasks.js'
import { ballTools } from './ball.js'
import { meetingTools } from './meetings.js'
import { reviewTools } from './reviews.js'
import { milestoneTools } from './milestones.js'
import { spaceTools } from './spaces.js'
import { activityTools } from './activity.js'
import { clientTools } from './clients.js'

const allTools = [...taskTools, ...ballTools, ...meetingTools, ...reviewTools, ...milestoneTools, ...spaceTools, ...activityTools, ...clientTools]

export function registerTools(server: Server): void {
  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: allTools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: {
          type: 'object' as const,
          properties: Object.fromEntries(
            Object.entries(tool.inputSchema.shape).map(([key, schema]) => [
              key,
              {
                type: getZodType(schema),
                description: (schema as { description?: string }).description || '',
              },
            ])
          ),
          required: Object.entries(tool.inputSchema.shape)
            .filter(([, schema]) => !(schema as { isOptional?: () => boolean }).isOptional?.())
            .map(([key]) => key),
        },
      })),
    }
  })

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params

    const tool = allTools.find((t) => t.name === name)
    if (!tool) {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      }
    }

    try {
      const validatedArgs = tool.inputSchema.parse(args)
      const result = await tool.handler(validatedArgs as never)
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        content: [{ type: 'text', text: `Error: ${message}` }],
        isError: true,
      }
    }
  })
}

// Helper to get Zod schema type as JSON Schema type
function getZodType(schema: unknown): string {
  const schemaAny = schema as { _def?: { typeName?: string } }
  const typeName = schemaAny._def?.typeName
  switch (typeName) {
    case 'ZodString':
      return 'string'
    case 'ZodNumber':
      return 'number'
    case 'ZodBoolean':
      return 'boolean'
    case 'ZodArray':
      return 'array'
    case 'ZodEnum':
      return 'string'
    case 'ZodOptional':
      return getZodType((schemaAny._def as { innerType?: unknown }).innerType)
    case 'ZodDefault':
      return getZodType((schemaAny._def as { innerType?: unknown }).innerType)
    default:
      return 'string'
  }
}
