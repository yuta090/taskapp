/**
 * Builtin manifest fallback.
 * Used when: no cache, server unreachable, or CLI < minCliVersion.
 * Contains a minimal subset of core commands for basic operation.
 */
import type { Manifest } from './manifest-validator.js';
export declare const BUILTIN_MANIFEST: Manifest;
