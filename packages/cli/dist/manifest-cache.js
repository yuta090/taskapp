/**
 * Manifest cache management with ETag, atomic writes, and fallback chain.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import chalk from 'chalk';
import { validateManifest, satisfiesVersion } from './manifest-validator.js';
import { BUILTIN_MANIFEST } from './builtin-manifest.js';
const CACHE_DIR = join(homedir(), '.agentpm');
const MANIFEST_PATH = join(CACHE_DIR, 'manifest.json');
const PREV_PATH = join(CACHE_DIR, 'manifest.prev.json');
const META_PATH = join(CACHE_DIR, 'manifest.meta.json');
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
// ── Meta helpers ──
function readMeta() {
    try {
        if (!existsSync(META_PATH))
            return null;
        return JSON.parse(readFileSync(META_PATH, 'utf-8'));
    }
    catch {
        return null;
    }
}
function saveMeta(meta) {
    mkdirSync(CACHE_DIR, { recursive: true, mode: 0o700 });
    const tmpPath = `${META_PATH}.${process.pid}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(meta), { mode: 0o600 });
    renameSync(tmpPath, META_PATH);
}
function isFresh(meta) {
    const fetchedAt = new Date(meta.fetchedAt).getTime();
    return Date.now() - fetchedAt < TTL_MS;
}
// ── Cache read/write ──
function readAndValidateCache(path) {
    try {
        if (!existsSync(path))
            return null;
        const raw = readFileSync(path, 'utf-8');
        const parsed = JSON.parse(raw);
        return validateManifest(parsed);
    }
    catch {
        return null; // corrupted or validation failed
    }
}
function atomicSaveCache(manifest) {
    mkdirSync(CACHE_DIR, { recursive: true, mode: 0o700 });
    const tmpPath = `${MANIFEST_PATH}.${process.pid}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });
    // Backup current → prev
    try {
        renameSync(MANIFEST_PATH, PREV_PATH);
    }
    catch {
        /* first run — no existing cache */
    }
    // Atomic swap
    renameSync(tmpPath, MANIFEST_PATH);
}
// ── Network fetch ──
async function fetchFromServer(apiUrl, apiKey, etag) {
    const headers = { Accept: 'application/json' };
    if (apiKey)
        headers['Authorization'] = `Bearer ${apiKey}`;
    if (etag)
        headers['If-None-Match'] = etag;
    const url = `${apiUrl.replace(/\/$/, '')}/api/cli/manifest`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
    if (res.status === 304) {
        return { etag, notModified: true };
    }
    if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
    }
    const manifest = await res.json();
    const newEtag = res.headers.get('etag') || undefined;
    return { manifest, etag: newEtag, notModified: false };
}
// ── Public API ──
/**
 * Load manifest with 5-level fallback chain:
 * 1. Fresh cache → 2. Server fetch → 3. Expired cache → 4. Prev backup → 5. Builtin
 */
export async function loadManifest(apiUrl, apiKey, cliVersion) {
    const meta = readMeta();
    // 1. Fresh cache
    if (meta && isFresh(meta)) {
        const cached = readAndValidateCache(MANIFEST_PATH);
        if (cached) {
            return applyVersionCheck(cached, cliVersion);
        }
    }
    // 2. Server fetch (with ETag for efficiency)
    try {
        const result = await fetchFromServer(apiUrl, apiKey, meta?.etag);
        if (result.notModified && meta) {
            // 304: Just refresh TTL
            saveMeta({ ...meta, fetchedAt: new Date().toISOString() });
            const cached = readAndValidateCache(MANIFEST_PATH);
            if (cached)
                return applyVersionCheck(cached, cliVersion);
        }
        if (result.manifest) {
            const validated = validateManifest(result.manifest);
            atomicSaveCache(validated);
            saveMeta({
                fetchedAt: new Date().toISOString(),
                version: validated.version,
                etag: result.etag,
            });
            return applyVersionCheck(validated, cliVersion);
        }
    }
    catch {
        // Network error — fall through to cached fallbacks
    }
    // 3. Expired cache
    const expired = readAndValidateCache(MANIFEST_PATH);
    if (expired) {
        console.error(chalk.yellow('Warning: Using cached manifest (server unreachable)'));
        return applyVersionCheck(expired, cliVersion);
    }
    // 4. Previous backup
    const prev = readAndValidateCache(PREV_PATH);
    if (prev) {
        console.error(chalk.yellow('Warning: Using previous manifest (cache corrupted)'));
        return applyVersionCheck(prev, cliVersion);
    }
    // 5. Builtin
    console.error(chalk.yellow('Warning: Using builtin commands (no manifest available)'));
    return BUILTIN_MANIFEST;
}
/**
 * Force-fetch latest manifest (for `agentpm update`)
 */
export async function forceUpdate(apiUrl, apiKey) {
    const result = await fetchFromServer(apiUrl, apiKey);
    if (!result.manifest) {
        throw new Error('Server returned no manifest');
    }
    const validated = validateManifest(result.manifest);
    atomicSaveCache(validated);
    saveMeta({
        fetchedAt: new Date().toISOString(),
        version: validated.version,
        etag: result.etag,
    });
    return validated;
}
/**
 * Version compatibility check.
 * CLI < minCliVersion → always use builtin (incompatible manifest)
 */
function applyVersionCheck(manifest, cliVersion) {
    if (!cliVersion)
        return manifest;
    if (!satisfiesVersion(cliVersion, manifest.minCliVersion)) {
        console.error(chalk.yellow(`Warning: CLI v${cliVersion} は古いです。` +
            `npm update -g @uzukko/agentpm でアップデートしてください`));
        return BUILTIN_MANIFEST;
    }
    return manifest;
}
//# sourceMappingURL=manifest-cache.js.map