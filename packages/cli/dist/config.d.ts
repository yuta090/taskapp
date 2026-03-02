export declare function getConfigPath(): string;
export declare function loadCliConfig(cliOpts: {
    apiKey?: string;
    spaceId?: string;
}): void;
export declare function resolveSpaceId(opts: {
    spaceId?: string;
}): string;
