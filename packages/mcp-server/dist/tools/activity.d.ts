import { z } from 'zod';
/**
 * activity_search / activity_entity_history は、データの変更の控え change_log を読む。
 * change_log は DB トリガーが主要な表の追加・更新・削除を全部記録する追記専用の表
 * （誰が・どの経路で・何を・いつ。migration 20260926091821_change_log.sql）。
 *
 * CLI から見せるのは、プロジェクトに属する次の表の行だけ。組織の請求・APIキー・招待・
 * プロフィールなどの控えは運営画面だけで見る。
 */
export declare const ALLOWED_ACTIVITY_ENTITY_TABLES: Set<string>;
export interface ChangeLogEntry {
    id: number;
    occurred_at: string;
    txid: number;
    table_name: string;
    op: 'I' | 'U' | 'D';
    action: 'insert' | 'update' | 'delete';
    row_pk: Record<string, unknown>;
    org_id: string | null;
    space_id: string | null;
    actor_kind: 'user' | 'api_key' | 'service' | 'system';
    actor_user_id: string | null;
    api_key_id: string | null;
    channel: string;
    request_id: string | null;
    changed_columns: string[] | null;
    old_row: Record<string, unknown> | null;
    new_row: Record<string, unknown> | null;
}
export declare const activitySearchSchema: z.ZodObject<{
    spaceId: z.ZodString;
    entityTable: z.ZodOptional<z.ZodString>;
    entityId: z.ZodOptional<z.ZodString>;
    actorId: z.ZodOptional<z.ZodString>;
    action: z.ZodOptional<z.ZodString>;
    from: z.ZodOptional<z.ZodString>;
    to: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    limit: number;
    action?: string | undefined;
    entityTable?: string | undefined;
    entityId?: string | undefined;
    actorId?: string | undefined;
    from?: string | undefined;
    to?: string | undefined;
}, {
    spaceId: string;
    action?: string | undefined;
    limit?: number | undefined;
    entityTable?: string | undefined;
    entityId?: string | undefined;
    actorId?: string | undefined;
    from?: string | undefined;
    to?: string | undefined;
}>;
export declare const activityEntityHistorySchema: z.ZodObject<{
    entityTable: z.ZodString;
    entityId: z.ZodString;
    limit: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    limit: number;
    entityTable: string;
    entityId: string;
}, {
    entityTable: string;
    entityId: string;
    limit?: number | undefined;
}>;
export declare function activitySearch(params: z.infer<typeof activitySearchSchema>): Promise<ChangeLogEntry[]>;
export declare function activityEntityHistory(params: z.infer<typeof activityEntityHistorySchema>): Promise<ChangeLogEntry[]>;
export declare const activityTools: ({
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        spaceId: z.ZodString;
        entityTable: z.ZodOptional<z.ZodString>;
        entityId: z.ZodOptional<z.ZodString>;
        actorId: z.ZodOptional<z.ZodString>;
        action: z.ZodOptional<z.ZodString>;
        from: z.ZodOptional<z.ZodString>;
        to: z.ZodOptional<z.ZodString>;
        limit: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        spaceId: string;
        limit: number;
        action?: string | undefined;
        entityTable?: string | undefined;
        entityId?: string | undefined;
        actorId?: string | undefined;
        from?: string | undefined;
        to?: string | undefined;
    }, {
        spaceId: string;
        action?: string | undefined;
        limit?: number | undefined;
        entityTable?: string | undefined;
        entityId?: string | undefined;
        actorId?: string | undefined;
        from?: string | undefined;
        to?: string | undefined;
    }>;
    handler: typeof activitySearch;
} | {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        entityTable: z.ZodString;
        entityId: z.ZodString;
        limit: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        limit: number;
        entityTable: string;
        entityId: string;
    }, {
        entityTable: string;
        entityId: string;
        limit?: number | undefined;
    }>;
    handler: typeof activityEntityHistory;
})[];
//# sourceMappingURL=activity.d.ts.map