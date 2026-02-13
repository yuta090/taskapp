import { z } from 'zod';
import { Task, TaskOwner } from '../supabase/client.js';
export declare const taskCreateSchema: z.ZodObject<{
    spaceId: z.ZodString;
    title: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    type: z.ZodDefault<z.ZodEnum<["task", "spec"]>>;
    ball: z.ZodDefault<z.ZodEnum<["client", "internal"]>>;
    origin: z.ZodDefault<z.ZodEnum<["client", "internal"]>>;
    clientScope: z.ZodDefault<z.ZodEnum<["deliverable", "internal"]>>;
    clientOwnerIds: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    internalOwnerIds: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    dueDate: z.ZodOptional<z.ZodString>;
    assigneeId: z.ZodOptional<z.ZodString>;
    milestoneId: z.ZodOptional<z.ZodString>;
    specPath: z.ZodOptional<z.ZodString>;
    decisionState: z.ZodOptional<z.ZodEnum<["considering", "decided", "implemented"]>>;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    title: string;
    type: "task" | "spec";
    ball: "client" | "internal";
    origin: "client" | "internal";
    clientScope: "internal" | "deliverable";
    clientOwnerIds: string[];
    internalOwnerIds: string[];
    description?: string | undefined;
    dueDate?: string | undefined;
    assigneeId?: string | undefined;
    milestoneId?: string | undefined;
    specPath?: string | undefined;
    decisionState?: "considering" | "decided" | "implemented" | undefined;
}, {
    spaceId: string;
    title: string;
    description?: string | undefined;
    type?: "task" | "spec" | undefined;
    ball?: "client" | "internal" | undefined;
    origin?: "client" | "internal" | undefined;
    clientScope?: "internal" | "deliverable" | undefined;
    clientOwnerIds?: string[] | undefined;
    internalOwnerIds?: string[] | undefined;
    dueDate?: string | undefined;
    assigneeId?: string | undefined;
    milestoneId?: string | undefined;
    specPath?: string | undefined;
    decisionState?: "considering" | "decided" | "implemented" | undefined;
}>;
export declare const taskUpdateSchema: z.ZodObject<{
    spaceId: z.ZodString;
    taskId: z.ZodString;
    title: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodString>;
    status: z.ZodOptional<z.ZodEnum<["backlog", "todo", "in_progress", "in_review", "done", "considering"]>>;
    dueDate: z.ZodOptional<z.ZodString>;
    assigneeId: z.ZodOptional<z.ZodString>;
    priority: z.ZodOptional<z.ZodNumber>;
    clientScope: z.ZodOptional<z.ZodEnum<["deliverable", "internal"]>>;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    taskId: string;
    title?: string | undefined;
    description?: string | undefined;
    clientScope?: "internal" | "deliverable" | undefined;
    status?: "backlog" | "todo" | "in_progress" | "in_review" | "done" | "considering" | undefined;
    dueDate?: string | undefined;
    assigneeId?: string | undefined;
    priority?: number | undefined;
}, {
    spaceId: string;
    taskId: string;
    title?: string | undefined;
    description?: string | undefined;
    clientScope?: "internal" | "deliverable" | undefined;
    status?: "backlog" | "todo" | "in_progress" | "in_review" | "done" | "considering" | undefined;
    dueDate?: string | undefined;
    assigneeId?: string | undefined;
    priority?: number | undefined;
}>;
export declare const taskListSchema: z.ZodObject<{
    spaceId: z.ZodString;
    ball: z.ZodOptional<z.ZodEnum<["client", "internal"]>>;
    status: z.ZodOptional<z.ZodEnum<["backlog", "todo", "in_progress", "in_review", "done", "considering"]>>;
    type: z.ZodOptional<z.ZodEnum<["task", "spec"]>>;
    clientScope: z.ZodOptional<z.ZodEnum<["deliverable", "internal"]>>;
    limit: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    limit: number;
    type?: "task" | "spec" | undefined;
    ball?: "client" | "internal" | undefined;
    clientScope?: "internal" | "deliverable" | undefined;
    status?: "backlog" | "todo" | "in_progress" | "in_review" | "done" | "considering" | undefined;
}, {
    spaceId: string;
    type?: "task" | "spec" | undefined;
    ball?: "client" | "internal" | undefined;
    clientScope?: "internal" | "deliverable" | undefined;
    status?: "backlog" | "todo" | "in_progress" | "in_review" | "done" | "considering" | undefined;
    limit?: number | undefined;
}>;
export declare const taskGetSchema: z.ZodObject<{
    spaceId: z.ZodString;
    taskId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    taskId: string;
}, {
    spaceId: string;
    taskId: string;
}>;
export declare const taskDeleteSchema: z.ZodObject<{
    spaceId: z.ZodString;
    taskId: z.ZodString;
    dryRun: z.ZodDefault<z.ZodBoolean>;
    confirmToken: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    dryRun: boolean;
    taskId: string;
    confirmToken?: string | undefined;
}, {
    spaceId: string;
    taskId: string;
    dryRun?: boolean | undefined;
    confirmToken?: string | undefined;
}>;
export declare const taskListMySchema: z.ZodObject<{
    ball: z.ZodOptional<z.ZodEnum<["client", "internal"]>>;
    status: z.ZodOptional<z.ZodEnum<["backlog", "todo", "in_progress", "in_review", "done", "considering"]>>;
    clientScope: z.ZodOptional<z.ZodEnum<["deliverable", "internal"]>>;
    limit: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    limit: number;
    ball?: "client" | "internal" | undefined;
    clientScope?: "internal" | "deliverable" | undefined;
    status?: "backlog" | "todo" | "in_progress" | "in_review" | "done" | "considering" | undefined;
}, {
    ball?: "client" | "internal" | undefined;
    clientScope?: "internal" | "deliverable" | undefined;
    status?: "backlog" | "todo" | "in_progress" | "in_review" | "done" | "considering" | undefined;
    limit?: number | undefined;
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
    taskId?: string;
    dryRun?: boolean;
    affectedCount?: number;
    confirmToken?: string;
    message?: string;
}>;
export declare function taskListMy(params: z.infer<typeof taskListMySchema>): Promise<{
    spaceId: string;
    spaceName: string;
    tasks: Task[];
}[]>;
export declare const taskTools: ({
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        spaceId: z.ZodString;
        title: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        type: z.ZodDefault<z.ZodEnum<["task", "spec"]>>;
        ball: z.ZodDefault<z.ZodEnum<["client", "internal"]>>;
        origin: z.ZodDefault<z.ZodEnum<["client", "internal"]>>;
        clientScope: z.ZodDefault<z.ZodEnum<["deliverable", "internal"]>>;
        clientOwnerIds: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        internalOwnerIds: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        dueDate: z.ZodOptional<z.ZodString>;
        assigneeId: z.ZodOptional<z.ZodString>;
        milestoneId: z.ZodOptional<z.ZodString>;
        specPath: z.ZodOptional<z.ZodString>;
        decisionState: z.ZodOptional<z.ZodEnum<["considering", "decided", "implemented"]>>;
    }, "strip", z.ZodTypeAny, {
        spaceId: string;
        title: string;
        type: "task" | "spec";
        ball: "client" | "internal";
        origin: "client" | "internal";
        clientScope: "internal" | "deliverable";
        clientOwnerIds: string[];
        internalOwnerIds: string[];
        description?: string | undefined;
        dueDate?: string | undefined;
        assigneeId?: string | undefined;
        milestoneId?: string | undefined;
        specPath?: string | undefined;
        decisionState?: "considering" | "decided" | "implemented" | undefined;
    }, {
        spaceId: string;
        title: string;
        description?: string | undefined;
        type?: "task" | "spec" | undefined;
        ball?: "client" | "internal" | undefined;
        origin?: "client" | "internal" | undefined;
        clientScope?: "internal" | "deliverable" | undefined;
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
        spaceId: z.ZodString;
        taskId: z.ZodString;
        title: z.ZodOptional<z.ZodString>;
        description: z.ZodOptional<z.ZodString>;
        status: z.ZodOptional<z.ZodEnum<["backlog", "todo", "in_progress", "in_review", "done", "considering"]>>;
        dueDate: z.ZodOptional<z.ZodString>;
        assigneeId: z.ZodOptional<z.ZodString>;
        priority: z.ZodOptional<z.ZodNumber>;
        clientScope: z.ZodOptional<z.ZodEnum<["deliverable", "internal"]>>;
    }, "strip", z.ZodTypeAny, {
        spaceId: string;
        taskId: string;
        title?: string | undefined;
        description?: string | undefined;
        clientScope?: "internal" | "deliverable" | undefined;
        status?: "backlog" | "todo" | "in_progress" | "in_review" | "done" | "considering" | undefined;
        dueDate?: string | undefined;
        assigneeId?: string | undefined;
        priority?: number | undefined;
    }, {
        spaceId: string;
        taskId: string;
        title?: string | undefined;
        description?: string | undefined;
        clientScope?: "internal" | "deliverable" | undefined;
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
        spaceId: z.ZodString;
        ball: z.ZodOptional<z.ZodEnum<["client", "internal"]>>;
        status: z.ZodOptional<z.ZodEnum<["backlog", "todo", "in_progress", "in_review", "done", "considering"]>>;
        type: z.ZodOptional<z.ZodEnum<["task", "spec"]>>;
        clientScope: z.ZodOptional<z.ZodEnum<["deliverable", "internal"]>>;
        limit: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        spaceId: string;
        limit: number;
        type?: "task" | "spec" | undefined;
        ball?: "client" | "internal" | undefined;
        clientScope?: "internal" | "deliverable" | undefined;
        status?: "backlog" | "todo" | "in_progress" | "in_review" | "done" | "considering" | undefined;
    }, {
        spaceId: string;
        type?: "task" | "spec" | undefined;
        ball?: "client" | "internal" | undefined;
        clientScope?: "internal" | "deliverable" | undefined;
        status?: "backlog" | "todo" | "in_progress" | "in_review" | "done" | "considering" | undefined;
        limit?: number | undefined;
    }>;
    handler: typeof taskList;
} | {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        spaceId: z.ZodString;
        taskId: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        spaceId: string;
        taskId: string;
    }, {
        spaceId: string;
        taskId: string;
    }>;
    handler: typeof taskGet;
} | {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        spaceId: z.ZodString;
        taskId: z.ZodString;
        dryRun: z.ZodDefault<z.ZodBoolean>;
        confirmToken: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        spaceId: string;
        dryRun: boolean;
        taskId: string;
        confirmToken?: string | undefined;
    }, {
        spaceId: string;
        taskId: string;
        dryRun?: boolean | undefined;
        confirmToken?: string | undefined;
    }>;
    handler: typeof taskDelete;
} | {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        ball: z.ZodOptional<z.ZodEnum<["client", "internal"]>>;
        status: z.ZodOptional<z.ZodEnum<["backlog", "todo", "in_progress", "in_review", "done", "considering"]>>;
        clientScope: z.ZodOptional<z.ZodEnum<["deliverable", "internal"]>>;
        limit: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        limit: number;
        ball?: "client" | "internal" | undefined;
        clientScope?: "internal" | "deliverable" | undefined;
        status?: "backlog" | "todo" | "in_progress" | "in_review" | "done" | "considering" | undefined;
    }, {
        ball?: "client" | "internal" | undefined;
        clientScope?: "internal" | "deliverable" | undefined;
        status?: "backlog" | "todo" | "in_progress" | "in_review" | "done" | "considering" | undefined;
        limit?: number | undefined;
    }>;
    handler: typeof taskListMy;
})[];
//# sourceMappingURL=tasks.d.ts.map