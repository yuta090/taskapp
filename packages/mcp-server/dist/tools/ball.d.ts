import { z } from 'zod';
import { Task, TaskOwner } from '../supabase/client.js';
export declare const ballPassSchema: z.ZodObject<{
    spaceId: z.ZodString;
    taskId: z.ZodString;
    ball: z.ZodEnum<["client", "internal"]>;
    clientOwnerIds: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    internalOwnerIds: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    reason: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    ball: "client" | "internal";
    clientOwnerIds: string[];
    internalOwnerIds: string[];
    taskId: string;
    reason?: string | undefined;
}, {
    spaceId: string;
    ball: "client" | "internal";
    taskId: string;
    reason?: string | undefined;
    clientOwnerIds?: string[] | undefined;
    internalOwnerIds?: string[] | undefined;
}>;
export declare const ballQuerySchema: z.ZodObject<{
    spaceId: z.ZodString;
    ball: z.ZodEnum<["client", "internal"]>;
    includeOwners: z.ZodDefault<z.ZodBoolean>;
    limit: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    ball: "client" | "internal";
    limit: number;
    includeOwners: boolean;
}, {
    spaceId: string;
    ball: "client" | "internal";
    limit?: number | undefined;
    includeOwners?: boolean | undefined;
}>;
export declare const dashboardGetSchema: z.ZodObject<{
    spaceId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
}, {
    spaceId: string;
}>;
export declare function ballPass(params: z.infer<typeof ballPassSchema>): Promise<{
    ok: boolean;
    task: Task;
}>;
export declare function ballQuery(params: z.infer<typeof ballQuerySchema>): Promise<{
    tasks: Task[];
    owners?: Record<string, TaskOwner[]>;
}>;
export interface DashboardData {
    totalTasks: number;
    ballClient: number;
    ballInternal: number;
    considering: number;
    inProgress: number;
    inReview: number;
    done: number;
    recentTasks: Task[];
    clientWaitingTasks: Task[];
}
export declare function dashboardGet(params: z.infer<typeof dashboardGetSchema>): Promise<DashboardData>;
export declare const ballTools: ({
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        spaceId: z.ZodString;
        taskId: z.ZodString;
        ball: z.ZodEnum<["client", "internal"]>;
        clientOwnerIds: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        internalOwnerIds: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        reason: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        spaceId: string;
        ball: "client" | "internal";
        clientOwnerIds: string[];
        internalOwnerIds: string[];
        taskId: string;
        reason?: string | undefined;
    }, {
        spaceId: string;
        ball: "client" | "internal";
        taskId: string;
        reason?: string | undefined;
        clientOwnerIds?: string[] | undefined;
        internalOwnerIds?: string[] | undefined;
    }>;
    handler: typeof ballPass;
} | {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        spaceId: z.ZodString;
        ball: z.ZodEnum<["client", "internal"]>;
        includeOwners: z.ZodDefault<z.ZodBoolean>;
        limit: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        spaceId: string;
        ball: "client" | "internal";
        limit: number;
        includeOwners: boolean;
    }, {
        spaceId: string;
        ball: "client" | "internal";
        limit?: number | undefined;
        includeOwners?: boolean | undefined;
    }>;
    handler: typeof ballQuery;
} | {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        spaceId: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        spaceId: string;
    }, {
        spaceId: string;
    }>;
    handler: typeof dashboardGet;
})[];
//# sourceMappingURL=ball.d.ts.map