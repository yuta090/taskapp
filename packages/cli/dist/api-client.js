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
        const body = (await response.json().catch(() => ({})));
        const detail = formatDetails(body.details);
        // error だけを出すと、入力チェックの「どの項目が・なぜ」（details）が消えるので後ろに添える
        const message = body.error && detail ? `${body.error}: ${detail}` : body.error || detail || `HTTP ${response.status}`;
        throw new Error(message);
    }
    return response.json();
}
/** サーバーの details（入力チェックの内容など）を1行で読める文にする。配列は「項目: 理由」を / でつなぐ */
function formatDetails(details) {
    if (details == null)
        return '';
    if (typeof details === 'string')
        return details;
    if (Array.isArray(details)) {
        return details
            .map((d) => {
            if (d && typeof d === 'object' && 'message' in d) {
                const { path, message } = d;
                const where = Array.isArray(path) && path.length > 0 ? `${path.join('.')}: ` : '';
                return `${where}${String(message)}`;
            }
            return JSON.stringify(d);
        })
            .join(' / ');
    }
    return JSON.stringify(details);
}
//# sourceMappingURL=api-client.js.map