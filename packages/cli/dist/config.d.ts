/** 接続先の既定値。初めての人が login で API URL を空欄のまま Enter しても本番につながる */
export declare const DEFAULT_API_URL = "https://agentpm.app";
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
