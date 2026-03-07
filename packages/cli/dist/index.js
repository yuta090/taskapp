import { Command } from 'commander';
import { loadCliConfig, getApiConfig, ConfigError } from './config.js';
import { registerConfigCommand } from './commands/config-cmd.js';
import { registerDynamicCommands } from './dynamic-loader.js';
import { loadManifest, forceUpdate } from './manifest-cache.js';
import chalk from 'chalk';
const CLI_VERSION = '0.2.0';
const program = new Command();
program
    .name('agentpm')
    .version(CLI_VERSION)
    .description('AgentPM CLI - AI-first task management')
    .option('--json', 'Output raw JSON')
    .option('-s, --space-id <uuid>', 'Override default space ID')
    .option('--api-key <key>', 'Override API key')
    .hook('preAction', (thisCommand, actionCommand) => {
    // Walk up to find the root command name
    let cmd = actionCommand;
    while (cmd.parent && cmd.parent !== thisCommand) {
        cmd = cmd.parent;
    }
    // config/login/update don't need auth
    const name = cmd.name();
    if (name === 'config' || name === 'login' || name === 'update')
        return;
    const opts = thisCommand.opts();
    try {
        loadCliConfig({ apiKey: opts.apiKey, spaceId: opts.spaceId });
    }
    catch (e) {
        if (e instanceof ConfigError) {
            console.error(chalk.red(`Error: ${e.message}`));
            process.exit(1);
        }
        throw e;
    }
});
// ── Always-builtin commands (needed before auth) ──
registerConfigCommand(program);
// ── Update command (force-fetch manifest) ──
program
    .command('update')
    .description('Fetch latest command manifest from server')
    .action(async () => {
    const opts = program.opts();
    loadCliConfig({ apiKey: opts.apiKey, spaceId: opts.spaceId });
    const { apiUrl, apiKey } = getApiConfig();
    try {
        const manifest = await forceUpdate(apiUrl, apiKey);
        console.log(chalk.green(`Updated to manifest v${manifest.version}`));
        console.log(chalk.gray(`${manifest.commands.length} command groups, ` +
            `${manifest.commands.reduce((n, c) => n + (c.subcommands?.length || 1), 0)} commands`));
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(chalk.red(`Update failed: ${msg}`));
        process.exit(1);
    }
});
// ── Dynamic command registration ──
async function main() {
    // Try to load config for manifest fetch (non-fatal if not configured)
    let apiUrl = '';
    let apiKey;
    try {
        const opts = program.opts();
        // Parse known options without executing actions
        const rawArgs = process.argv.slice(2);
        const apiKeyIdx = rawArgs.indexOf('--api-key');
        const passedApiKey = apiKeyIdx >= 0 ? rawArgs[apiKeyIdx + 1] : undefined;
        loadCliConfig({ apiKey: passedApiKey, spaceId: opts.spaceId });
        const config = getApiConfig();
        apiUrl = config.apiUrl;
        apiKey = config.apiKey;
    }
    catch {
        // Not configured — will use builtin manifest
    }
    if (apiUrl) {
        const manifest = await loadManifest(apiUrl, apiKey, CLI_VERSION);
        registerDynamicCommands(program, manifest);
    }
    else {
        // No config — register builtin for --help to work
        const { BUILTIN_MANIFEST } = await import('./builtin-manifest.js');
        registerDynamicCommands(program, BUILTIN_MANIFEST);
    }
    await program.parseAsync();
}
main().catch((e) => {
    console.error(chalk.red(e instanceof Error ? e.message : String(e)));
    process.exit(1);
});
//# sourceMappingURL=index.js.map