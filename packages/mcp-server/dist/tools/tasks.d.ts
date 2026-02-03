import { z } from 'zod';
import { Task, TaskOwner } from '../supabase/client.js';
export declare const taskCreateSchema: z.ZodObject<{
    title: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    type: z.ZodDefault<z.ZodEnum<["task", "spec"]>>;
    ball: z.ZodDefault<z.ZodEnum<["client", "internal"]>>;
    origin: z.ZodDefault<z.ZodEnum<["client", "internal"]>>;
    clientOwnerIds: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    internalOwnerIds: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    dueDate: z.ZodOptional<z.ZodString>;
    assigneeId: z.ZodOptional<z.ZodString>;
    milestoneId: z.ZodOptional<z.ZodString>;
    specPath: z.ZodOptional<z.ZodString>;
    decisionState: z.ZodOptional<z.ZodEnum<["considering", "decided", "implemented"]>>;
}, "strip", z.ZodTypeAny, {
    title: string;
    type: "task" | "spec";
    ball: "client" | "internal";
    origin: "client" | "internal";
    clientOwnerIds: string[];
    internalOwnerIds: string[];
    description?: string | undefined;
    dueDate?: string | undefined;
    assigneeId?: string | undefined;
    milestoneId?: string | undefined;
    specPath?: string | undefined;
    decisionState?: "considering" | "decided" | "implemented" | undefined;
}, {
    title: string;
    description?: string | undefined;
    type?: "task" | "spec" | undefined;
    ball?: "client" | "internal" | undefined;
    origin?: "client" | "internal" | undefined;
    clientOwnerIds?: string[] | undefined;
    internalOwnerIds?: string[] | undefined;
    dueDate?: string | undefined;
    assigneeId?: string | undefined;
    milestoneId?: string | undefined;
    specPath?: string | undefined;
    decisionState?: "considering" | "decided" | "implemented" | undefined;
}>;
export declare const taskUpdateSchema: z.ZodObject<{
    taskId: z.ZodString;
    title: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodString>;
    status: z.ZodOptional<z.ZodEnum<["backlog", "todo", "in_progress", "in_review", "done", "considering"]>>;
    dueDate: z.ZodOptional<z.ZodString>;
    assigneeId: z.ZodOptional<z.ZodString>;
    priority: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    taskId: string;
    title?: string | undefined;
    description?: string | undefined;
    status?: "backlog" | "todo" | "in_progress" | "in_review" | "done" | "considering" | undefined;
    dueDate?: string | undefined;
    assigneeId?: string | undefined;
    priority?: number | undefined;
}, {
    taskId: string;
    title?: string | undefined;
    description?: string | undefined;
    status?: "backlog" | "todo" | "in_progress" | "in_review" | "done" | "considering" | undefined;
    dueDate?: string | undefined;
    assigneeId?: string | undefined;
    priority?: number | undefined;
}>;
export declare const taskListSchema: z.ZodObject<{
    spaceId: z.ZodOptional<z.ZodString>;
    ball: z.ZodOptional<z.ZodEnum<["client", "internal"]>>;
    status: z.ZodOptional<z.ZodEnum<["backlog", "todo", "in_progress", "in_review", "done", "considering"]>>;
    type: z.ZodOptional<z.ZodEnum<["task", "spec"]>>;
    limit: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    limit: number;
    type?: "task" | "spec" | undefined;
    ball?: "client" | "internal" | undefined;
    status?: "backlog" | "todo" | "in_progress" | "in_review" | "done" | "considering" | undefined;
    spaceId?: string | undefined;
}, {
    type?: "task" | "spec" | undefined;
    ball?: "client" | "internal" | undefined;
    status?: "backlog" | "todo" | "in_progress" | "in_review" | "done" | "considering" | undefined;
    spaceId?: string | undefined;
    limit?: number | undefined;
}>;
export declare const taskGetSchema: z.ZodObject<{
    taskId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    taskId: string;
}, {
    taskId: string;
}>;
export declare const taskDeleteSchema: z.ZodObject<{
    taskId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    taskId: string;
}, {
    taskId: string;
}>;
export declare function taskCreate(params: z.infer<typeof taskCreateSchema>): Promise<{
    task: Task;
    owners: TaskOwner[];
}>;
export declare function taskUpdate(params: z.infer<typeof taskUpdateSchema>): Promise<Task>;
export declare function taskList(params: z.infer<typeof taskListSchema>): Promise<Task[]>;
export declare function taskGet(params: z.infer<typeof taskGetSchema>): Promise<{
    task: Task;
    owners: TaskOwner[];
}>;
export declare function taskDelete(params: z.infer<typeof taskDeleteSchema>): Promise<{
    success: boolean;
    taskId: string;
}>;
export declare const taskTools: ({
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        title: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        type: z.ZodDefault<z.ZodEnum<["task", "spec"]>>;
        ball: z.ZodDefault<z.ZodEnum<["client", "internal"]>>;
        origin: z.ZodDefault<z.ZodEnum<["client", "internal"]>>;
        clientOwnerIds: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        internalOwnerIds: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        dueDate: z.ZodOptional<z.ZodString>;
        assigneeId: z.ZodOptional<z.ZodString>;
        milestoneId: z.ZodOptional<z.ZodString>;
        specPath: z.ZodOptional<z.ZodString>;
        decisionState: z.ZodOptional<z.ZodEnum<["considering", "decided", "implemented"]>>;
    }, "strip", z.ZodTypeAny, {
        title: string;
        type: "task" | "spec";
        ball: "client" | "internal";
        origin: "client" | "internal";
        clientOwnerIds: string[];
        internalOwnerIds: string[];
        description?: string | undefined;
        dueDate?: string | undefined;
        assigneeId?: string | undefined;
        milestoneId?: string | undefined;
        specPath?: string | undefined;
        decisionState?: "considering" | "decided" | "implemented" | undefined;
    }, {
        title: string;
        description?: string | undefined;
        type?: "task" | "spec" | undefined;
        ball?: "client" | "internal" | undefined;
        origin?: "client" | "internal" | undefined;
        clientOwnerIds?: string[] | undefined;
        internalOwnerIds?: string[] | undefined;
        dueDate?: string | undefined;
        assigneeId?: string | undefined;
        milestoneId?: string | undefined;
        specPath?: string | undefined;
        decisionState?: "considering" | "decided" | "implemented" | undefined;
    }>;
    handler: typeof taskCreate;
} | {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        taskId: z.ZodString;
        title: z.ZodOptional<z.ZodString>;
        description: z.ZodOptional<z.ZodString>;
        status: z.ZodOptional<z.ZodEnum<["backlog", "todo", "in_progress", "in_review", "done", "considering"]>>;
        dueDate: z.ZodOptional<z.ZodString>;
        assigneeId: z.ZodOptional<z.ZodString>;
        priority: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        taskId: string;
        title?: string | undefined;
        description?: string | undefined;
        status?: "backlog" | "todo" | "in_progress" | "in_review" | "done" | "considering" | undefined;
        dueDate?: string | undefined;
        assigneeId?: string | undefined;
        priority?: number | undefined;
    }, {
        taskId: string;
        title?: string | undefined;
        description?: string | undefined;
        status?: "backlog" | "todo" | "in_progress" | "in_review" | "done" | "considering" | undefined;
        dueDate?: string | undefined;
        assigneeId?: string | undefined;
        priority?: number | undefined;
    }>;
    handler: typeof taskUpdate;
} | {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        spaceId: z.ZodOptional<z.ZodString>;
        ball: z.ZodOptional<z.ZodEnum<["client", "internal"]>>;
        status: z.ZodOptional<z.ZodEnum<["backlog", "todo", "in_progress", "in_review", "done", "considering"]>>;
        type: z.ZodOptional<z.ZodEnum<["task", "spec"]>>;
        limit: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        limit: number;
        type?: "task" | "spec" | undefined;
        ball?: "client" | "internal" | undefined;
        status?: "backlog" | "todo" | "in_progress" | "in_review" | "done" | "considering" | undefined;
        spaceId?: string | undefined;
    }, {
        type?: "task" | "spec" | undefined;
        ball?: "client" | "internal" | undefined;
        status?: "backlog" | "todo" | "in_progress" | "in_review" | "done" | "considering" | undefined;
        spaceId?: string | undefined;
        limit?: number | undefined;
    }>;
    handler: typeof taskList;
} | {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        taskId: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        taskId: string;
    }, {
        taskId: string;
    }>;
    handler: typeof taskGet;
} | {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        taskId: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        taskId: string;
    }, {
        taskId: string;
    }>;
    handler: typeof taskDelete;
})[];
//# sourceMappingURL=tasks.d.ts.map