import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { setApiConfig } from './api-client.js';
const CONFIG_PATH = join(homedir(), '.taskapprc.json');
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
    // Priority: CLI flags > env vars > config file
    const apiUrl = process.env.TASKAPP_API_URL || fileConfig.apiUrl;
    const apiKey = cliOpts.apiKey || process.env.TASKAPP_API_KEY || fileConfig.apiKey;
    if (!apiUrl || !apiKey) {
        console.error('Error: Not configured. Run: agentpm login');
        process.exit(1);
    }
    setApiConfig(apiUrl, apiKey);
    // Set space ID for resolveSpaceId
    const spaceId = cliOpts.spaceId || process.env.TASKAPP_SPACE_ID || fileConfig.defaultSpaceId;
    if (spaceId) {
        process.env.TASKAPP_SPACE_ID = spaceId;
    }
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