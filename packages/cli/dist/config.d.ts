export declare class ConfigError extends Error {
    constructor(message: string);
}
export declare function getConfigPath(): string;
export declare function loadCliConfig(cliOpts: {
    apiKey?: string;
    spaceId?: string;
}): void;
export declare function getApiConfig(): {
    apiUrl: string;
    apiKey: string;
};
export declare function resolveSpaceId(opts: {
    spaceId?: string;
}): string;
