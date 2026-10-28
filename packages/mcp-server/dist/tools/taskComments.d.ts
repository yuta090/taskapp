import { z } from 'zod';
export declare const taskCommentAddSchema: z.ZodObject<{
    spaceId: z.ZodString;
    taskId: z.ZodString;
    body: z.ZodString;
    visibility: z.ZodDefault<z.ZodEnum<["client", "internal"]>>;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    taskId: string;
    body: string;
    visibility: "client" | "internal";
}, {
    spaceId: string;
    taskId: string;
    body: string;
    visibility?: "client" | "internal" | undefined;
}>;
export declare const taskCommentListSchema: z.ZodObject<{
    spaceId: z.ZodString;
    taskId: z.ZodString;
    limit: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    taskId: string;
    limit: number;
}, {
    spaceId: string;
    taskId: string;
    limit?: number | undefined;
}>;
export interface TaskCommentRow {
    id: string;
    org_id: string;
    space_id: string;
    task_id: string;
    actor_id: string;
    body: string;
    visibility: 'client' | 'internal';
    [key: string]: unknown;
}
export declare function taskCommentAdd(params: z.infer<typeof taskCommentAddSchema>): Promise<TaskCommentRow & {
    link: string;
}>;
export declare function taskCommentList(params: z.infer<typeof taskCommentListSchema>): Promise<Array<TaskCommentRow & {
    actor_name?: string;
}>>;
export declare const taskCommentTools: ({
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        spaceId: z.ZodString;
        taskId: z.ZodString;
        body: z.ZodString;
        visibility: z.ZodDefault<z.ZodEnum<["client", "internal"]>>;
    }, "strip", z.ZodTypeAny, {
        spaceId: string;
        taskId: string;
        body: string;
        visibility: "client" | "internal";
    }, {
        spaceId: string;
        taskId: string;
        body: string;
        visibility?: "client" | "internal" | undefined;
    }>;
    handler: typeof taskCommentAdd;
} | {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        spaceId: z.ZodString;
        taskId: z.ZodString;
        limit: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        spaceId: string;
        taskId: string;
        limit: number;
    }, {
        spaceId: string;
        taskId: string;
        limit?: number | undefined;
    }>;
    handler: typeof taskCommentList;
})[];
//# sourceMappingURL=taskComments.d.ts.map