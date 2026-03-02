let _apiUrl;
let _apiKey;
export function setApiConfig(apiUrl, apiKey) {
    _apiUrl = apiUrl;
    _apiKey = apiKey;
}
export async function callTool(toolName, params) {
    if (!_apiUrl || !_apiKey) {
        console.error('Error: Not configured. Run: agentpm login');
        process.exit(1);
    }
    const url = `${_apiUrl.replace(/\/$/, '')}/api/tools`;
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${_apiKey}`,
        },
        body: JSON.stringify({ tool: toolName, params }),
    });
    if (!response.ok) {
        const body = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(body.error || body.details || `HTTP ${response.status}`);
    }
    return response.json();
}
//# sourceMappingURL=api-client.js.map