// Built-in defaults for the CLI.
// For npm publish builds, these are injected at build time via scripts/inject-defaults.sh.
// Developers can override any value via env vars or ~/.taskapprc.json.
export const defaults = {
    supabaseUrl: process.env.TASKAPP_BUILTIN_SUPABASE_URL || '',
    supabaseServiceKey: process.env.TASKAPP_BUILTIN_SUPABASE_SERVICE_KEY || '',
};
//# sourceMappingURL=defaults.js.map