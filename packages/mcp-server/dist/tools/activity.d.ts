import { z } from 'zod';
export interface ActivityLog {
    id: string;
    occurred_at: string;
    actor_id: string | null;
    actor_type: string;
    actor_service: string | null;
    request_id: string | null;
    session_id: string | null;
    entity_schema: string;
    entity_table: string;
    entity_id: string | null;
    entity_key: string | null;
    entity_display: string | null;
    action: string;
    reason: string | null;
    status: string;
    changed_fields: string[] | null;
    before_data: Record<string, unknown> | null;
    after_data: Record<string, unknown> | null;
    payload: Record<string, unknown>;
    related_table: string | null;
    related_id: string | null;
    organization_id: string | null;
    space_id: string | null;
    is_deleted: boolean;
}
export declare const activityLogSchema: z.ZodObject<{
    entityTable: z.ZodString;
    entityId: z.ZodString;
    action: z.ZodString;
    actorType: z.ZodDefault<z.ZodEnum<["user", "system", "ai", "service"]>>;
    actorService: z.ZodOptional<z.ZodString>;
    requestId: z.ZodOptional<z.ZodString>;
    sessionId: z.ZodOptional<z.ZodString>;
    entityDisplay: z.ZodOptional<z.ZodString>;
    reason: z.ZodOptional<z.ZodString>;
    status: z.ZodDefault<z.ZodEnum<["ok", "error", "warning"]>>;
    changedFields: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    beforeData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    afterData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    payload: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    status: "error" | "ok" | "warning";
    entityTable: string;
    entityId: string;
    action: string;
    actorType: "user" | "system" | "ai" | "service";
    reason?: string | undefined;
    actorService?: string | undefined;
    requestId?: string | undefined;
    sessionId?: string | undefined;
    entityDisplay?: string | undefined;
    changedFields?: string[] | undefined;
    beforeData?: Record<string, unknown> | undefined;
    afterData?: Record<string, unknown> | undefined;
    payload?: Record<string, unknown> | undefined;
}, {
    entityTable: string;
    entityId: string;
    action: string;
    status?: "error" | "ok" | "warning" | undefined;
    reason?: string | undefined;
    actorType?: "user" | "system" | "ai" | "service" | undefined;
    actorService?: string | undefined;
    requestId?: string | undefined;
    sessionId?: string | undefined;
    entityDisplay?: string | undefined;
    changedFields?: string[] | undefined;
    beforeData?: Record<string, unknown> | undefined;
    afterData?: Record<string, unknown> | undefined;
    payload?: Record<string, unknown> | undefined;
}>;
export declare const activitySearchSchema: z.ZodObject<{
    entityTable: z.ZodOptional<z.ZodString>;
    entityId: z.ZodOptional<z.ZodString>;
    actorId: z.ZodOptional<z.ZodString>;
    action: z.ZodOptional<z.ZodString>;
    from: z.ZodOptional<z.ZodString>;
    to: z.ZodOptional<z.ZodString>;
    sessionId: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    limit: number;
    entityTable?: string | undefined;
    entityId?: string | undefined;
    action?: string | undefined;
    sessionId?: string | undefined;
    actorId?: string | undefined;
    from?: string | undefined;
    to?: string | undefined;
}, {
    limit?: number | undefined;
    entityTable?: string | undefined;
    entityId?: string | undefined;
    action?: string | undefined;
    sessionId?: string | undefined;
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
export declare function activityLog(params: z.infer<typeof activityLogSchema>): Promise<{
    id: string;
}>;
export declare function activitySearch(params: z.infer<typeof activitySearchSchema>): Promise<ActivityLog[]>;
export declare function activityEntityHistory(params: z.infer<typeof activityEntityHistorySchema>): Promise<ActivityLog[]>;
export declare const activityTools: ({
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        entityTable: z.ZodString;
        entityId: z.ZodString;
        action: z.ZodString;
        actorType: z.ZodDefault<z.ZodEnum<["user", "system", "ai", "service"]>>;
        actorService: z.ZodOptional<z.ZodString>;
        requestId: z.ZodOptional<z.ZodString>;
        sessionId: z.ZodOptional<z.ZodString>;
        entityDisplay: z.ZodOptional<z.ZodString>;
        reason: z.ZodOptional<z.ZodString>;
        status: z.ZodDefault<z.ZodEnum<["ok", "error", "warning"]>>;
        changedFields: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        beforeData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        afterData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        payload: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, "strip", z.ZodTypeAny, {
        status: "error" | "ok" | "warning";
        entityTable: string;
        entityId: string;
        action: string;
        actorType: "user" | "system" | "ai" | "service";
        reason?: string | undefined;
        actorService?: string | undefined;
        requestId?: string | undefined;
        sessionId?: string | undefined;
        entityDisplay?: string | undefined;
        changedFields?: string[] | undefined;
        beforeData?: Record<string, unknown> | undefined;
        afterData?: Record<string, unknown> | undefined;
        payload?: Record<string, unknown> | undefined;
    }, {
        entityTable: string;
        entityId: string;
        action: string;
        status?: "error" | "ok" | "warning" | undefined;
        reason?: string | undefined;
        actorType?: "user" | "system" | "ai" | "service" | undefined;
        actorService?: string | undefined;
        requestId?: string | undefined;
        sessionId?: string | undefined;
        entityDisplay?: string | undefined;
        changedFields?: string[] | undefined;
        beforeData?: Record<string, unknown> | undefined;
        afterData?: Record<string, unknown> | undefined;
        payload?: Record<string, unknown> | undefined;
    }>;
    handler: typeof activityLog;
} | {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        entityTable: z.ZodOptional<z.ZodString>;
        entityId: z.ZodOptional<z.ZodString>;
        actorId: z.ZodOptional<z.ZodString>;
        action: z.ZodOptional<z.ZodString>;
        from: z.ZodOptional<z.ZodString>;
        to: z.ZodOptional<z.ZodString>;
        sessionId: z.ZodOptional<z.ZodString>;
        limit: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        limit: number;
        entityTable?: string | undefined;
        entityId?: string | undefined;
        action?: string | undefined;
        sessionId?: string | undefined;
        actorId?: string | undefined;
        from?: string | undefined;
        to?: string | undefined;
    }, {
        limit?: number | undefined;
        entityTable?: string | undefined;
        entityId?: string | undefined;
        action?: string | undefined;
        sessionId?: string | undefined;
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