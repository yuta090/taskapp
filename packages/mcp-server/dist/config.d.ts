export interface McpServerConfig {
    supabaseUrl: string;
    supabaseServiceKey: string;
    orgId: string;
    spaceId: string;
    actorId: string;
}
export declare function loadConfig(): McpServerConfig;
export declare const config: McpServerConfig;
//# sourceMappingURL=config.d.ts.map