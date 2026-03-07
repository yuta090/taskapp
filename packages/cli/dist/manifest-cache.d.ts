import type { Manifest } from './manifest-validator.js';
/**
 * Load manifest with 5-level fallback chain:
 * 1. Fresh cache → 2. Server fetch → 3. Expired cache → 4. Prev backup → 5. Builtin
 */
export declare function loadManifest(apiUrl: string, apiKey?: string, cliVersion?: string): Promise<Manifest>;
/**
 * Force-fetch latest manifest (for `agentpm update`)
 */
export declare function forceUpdate(apiUrl: string, apiKey?: string): Promise<Manifest>;
