export interface ManifestOption {
    flags: string;
    description?: string;
    param: string;
    required?: boolean;
    default?: string;
    type?: 'int' | 'float' | 'bool' | 'json' | 'string[]' | 'negatable';
    choices?: string[];
    resolve?: 'spaceId';
    dependsOn?: string;
    conflictsWith?: string;
}
export interface ManifestSubcommand {
    name: string;
    description: string;
    aliases?: string[];
    tool: string;
    examples?: string[];
    deprecated?: boolean;
    hidden?: boolean;
    stdinMode?: boolean;
    options: ManifestOption[];
}
export interface ManifestCommand {
    name: string;
    description: string;
    aliases?: string[];
    tool?: string;
    options?: ManifestOption[];
    subcommands?: ManifestSubcommand[];
}
export interface Manifest {
    version: string;
    minCliVersion: string;
    generatedAt: string;
    checksum: string;
    commands: ManifestCommand[];
}
/** Strip ANSI escape sequences and control characters */
export declare function sanitize(str: string): string;
/**
 * Validate a parsed manifest object.
 * Returns the typed manifest or throws ManifestValidationError.
 */
export declare function validateManifest(raw: unknown): Manifest;
/**
 * Compare semver strings: returns true if current >= required
 */
export declare function satisfiesVersion(current: string, required: string): boolean;
