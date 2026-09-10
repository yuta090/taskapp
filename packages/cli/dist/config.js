import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { setApiConfig } from './api-client.js';
const CONFIG_PATH = join(homedir(), '.taskapprc.json');
/** 接続先の既定値。初めての人が login で API URL を空欄のまま Enter しても本番につながる */
export const DEFAULT_API_URL = 'https://agentpm.app';
export class ConfigError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ConfigError';
    }
}
// Store resolved config for getApiConfig()
let _resolvedApiUrl = '';
let _resolvedApiKey = '';
export function getConfigPath() {
    return CONFIG_PATH;
}
export function loadCliConfig(cliOpts) {
    let fileConfig = {};
    if (existsSync(CONFIG_PATH)) {
        try {
            fileConfig = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
        }
        catch {
            // ignore invalid config file
        }
    }
    // Priority: CLI flags > env vars > config file > default
    const apiUrl = process.env.TASKAPP_API_URL || fileConfig.apiUrl || DEFAULT_API_URL;
    const apiKey = cliOpts.apiKey || process.env.TASKAPP_API_KEY || fileConfig.apiKey;
    if (!apiKey) {
        throw new ConfigError('Not configured. Run: agentpm login');
    }
    _resolvedApiUrl = apiUrl;
    _resolvedApiKey = apiKey;
    setApiConfig(apiUrl, apiKey);
    // Set space ID for resolveSpaceId
    const spaceId = cliOpts.spaceId || process.env.TASKAPP_SPACE_ID || fileConfig.defaultSpaceId;
    if (spaceId) {
        process.env.TASKAPP_SPACE_ID = spaceId;
    }
}
export function getApiConfig() {
    return { apiUrl: _resolvedApiUrl, apiKey: _resolvedApiKey };
}
export function resolveSpaceId(opts) {
    const spaceId = opts.spaceId || process.env.TASKAPP_SPACE_ID;
    if (!spaceId) {
        console.error('Error: --space-id is required (or set TASKAPP_SPACE_ID / defaultSpaceId in ~/.taskapprc.json)');
        process.exit(1);
    }
    return spaceId;
}
//# sourceMappingURL=config.js.map