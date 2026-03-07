/**
 * Dynamic command registration from manifest JSON.
 * Converts manifest definitions → Commander.js commands at runtime.
 */
import { Command } from 'commander';
import type { Manifest } from './manifest-validator.js';
/**
 * Register all commands from a manifest onto the program.
 */
export declare function registerDynamicCommands(program: Command, manifest: Manifest): void;
