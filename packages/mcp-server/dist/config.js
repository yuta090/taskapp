import { config as dotenvConfig } from 'dotenv';
dotenvConfig();
function getEnvOrThrow(key) {
    const value = process.env[key];
    if (!value) {
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return value;
}
function getEnvOrDefault(key, defaultValue) {
    return process.env[key] || defaultValue;
}
export function loadConfig() {
    return {
        supabaseUrl: getEnvOrThrow('SUPABASE_URL'),
        supabaseServiceKey: getEnvOrThrow('SUPABASE_SERVICE_KEY'),
        orgId: getEnvOrDefault('TASKAPP_ORG_ID', '00000000-0000-0000-0000-000000000001'),
        spaceId: getEnvOrDefault('TASKAPP_SPACE_ID', '00000000-0000-0000-0000-000000000010'),
        actorId: getEnvOrDefault('TASKAPP_ACTOR_ID', '00000000-0000-0000-0000-000000000099'),
    };
}
export const config = loadConfig();
//# sourceMappingURL=config.js.map