let _apiUrl: string | undefined
let _apiKey: string | undefined

export function setApiConfig(apiUrl: string, apiKey: string): void {
  _apiUrl = apiUrl
  _apiKey = apiKey
}

export async function callTool(toolName: string, params: Record<string, unknown>): Promise<unknown> {
  if (!_apiUrl || !_apiKey) {
    console.error('Error: Not configured. Run: agentpm login')
    process.exit(1)
  }

  const url = `${_apiUrl.replace(/\/$/, '')}/api/tools`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${_apiKey}`,
    },
    body: JSON.stringify({ tool: toolName, params }),
  })

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: `HTTP ${response.status}` })) as { error?: string; details?: string }
    throw new Error(body.error || body.details || `HTTP ${response.status}`)
  }

  return response.json()
}
