import { Server } from '@modelcontextprotocol/sdk/server/index.js';
export declare const allTools: ({
    name: string;
    description: string;
    inputSchema: import("zod").ZodObject<{
        spaceId: import("zod").ZodString;
        title: import("zod").ZodString;
        description: import("zod").ZodOptional<import("zod").ZodString>;
        type: import("zod").ZodDefault<import("zod").ZodEnum<["task", "spec"]>>;
        ball: import("zod").ZodDefault<import("zod").ZodEnum<["client", "internal"]>>;
        origin: import("zod").ZodDefault<import("zod").ZodEnum<["client", "internal"]>>;
        clientScope: import("zod").ZodDefault<import("zod").ZodEnum<["deliverable", "internal"]>>;
        clientOwnerIds: import("zod").ZodDefault<import("zod").ZodArray<import("zod").ZodString, "many">>;
        internalOwnerIds: import("zod").ZodDefault<import("zod").ZodArray<import("zod").ZodString, "many">>;
        dueDate: import("zod").ZodOptional<import("zod").ZodString>;
        assigneeId: import("zod").ZodOptional<import("zod").ZodString>;
        milestoneId: import("zod").ZodOptional<import("zod").ZodString>;
        specPath: import("zod").ZodOptional<import("zod").ZodString>;
        decisionState: import("zod").ZodOptional<import("zod").ZodEnum<["considering", "decided", "implemented"]>>;
    }, "strip", import("zod").ZodTypeAny, {
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
    handler: typeof import("./tasks.js").taskCreate;
} | {
    name: string;
    description: string;
    inputSchema: import("zod").ZodObject<{
        spaceId: import("zod").ZodString;
        taskId: import("zod").ZodString;
        title: import("zod").ZodOptional<import("zod").ZodString>;
        description: import("zod").ZodOptional<import("zod").ZodString>;
        status: import("zod").ZodOptional<import("zod").ZodEnum<["backlog", "todo", "in_progress", "in_review", "done", "considering"]>>;
        dueDate: import("zod").ZodOptional<import("zod").ZodString>;
        assigneeId: import("zod").ZodOptional<import("zod").ZodString>;
        priority: import("zod").ZodOptional<import("zod").ZodNumber>;
        clientScope: import("zod").ZodOptional<import("zod").ZodEnum<["deliverable", "internal"]>>;
        startDate: import("zod").ZodNullable<import("zod").ZodOptional<import("zod").ZodString>>;
        parentTaskId: import("zod").ZodNullable<import("zod").ZodOptional<import("zod").ZodString>>;
        actualHours: import("zod").ZodNullable<import("zod").ZodOptional<import("zod").ZodNumber>>;
        milestoneId: import("zod").ZodNullable<import("zod").ZodOptional<import("zod").ZodString>>;
    }, "strip", import("zod").ZodTypeAny, {
        spaceId: string;
        taskId: string;
        title?: string | undefined;
        description?: string | undefined;
        clientScope?: "internal" | "deliverable" | undefined;
        status?: "backlog" | "todo" | "in_progress" | "in_review" | "done" | "considering" | undefined;
        dueDate?: string | undefined;
        assigneeId?: string | undefined;
        milestoneId?: string | null | undefined;
        priority?: number | undefined;
        startDate?: string | null | undefined;
        parentTaskId?: string | null | undefined;
        actualHours?: number | null | undefined;
    }, {
        spaceId: string;
        taskId: string;
        title?: string | undefined;
        description?: string | undefined;
        clientScope?: "internal" | "deliverable" | undefined;
        status?: "backlog" | "todo" | "in_progress" | "in_review" | "done" | "considering" | undefined;
        dueDate?: string | undefined;
        assigneeId?: string | undefined;
        milestoneId?: string | null | undefined;
        priority?: number | undefined;
        startDate?: string | null | undefined;
        parentTaskId?: string | null | undefined;
        actualHours?: number | null | undefined;
    }>;
    handler: typeof import("./tasks.js").taskUpdate;
} | {
    name: string;
    description: string;
    inputSchema: import("zod").ZodObject<{
        spaceId: import("zod").ZodString;
        ball: import("zod").ZodOptional<import("zod").ZodEnum<["client", "internal"]>>;
        status: import("zod").ZodOptional<import("zod").ZodEnum<["backlog", "todo", "in_progress", "in_review", "done", "considering"]>>;
        type: import("zod").ZodOptional<import("zod").ZodEnum<["task", "spec"]>>;
        clientScope: import("zod").ZodOptional<import("zod").ZodEnum<["deliverable", "internal"]>>;
        limit: import("zod").ZodDefault<import("zod").ZodNumber>;
    }, "strip", import("zod").ZodTypeAny, {
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
    handler: typeof import("./tasks.js").taskList;
} | {
    name: string;
    description: string;
    inputSchema: import("zod").ZodObject<{
        spaceId: import("zod").ZodString;
        taskId: import("zod").ZodString;
    }, "strip", import("zod").ZodTypeAny, {
        spaceId: string;
        taskId: string;
    }, {
        spaceId: string;
        taskId: string;
    }>;
    handler: typeof import("./tasks.js").taskGet;
} | {
    name: string;
    description: string;
    inputSchema: import("zod").ZodObject<{
        spaceId: import("zod").ZodString;
        taskId: import("zod").ZodString;
        dryRun: import("zod").ZodDefault<import("zod").ZodBoolean>;
        confirmToken: import("zod").ZodOptional<import("zod").ZodString>;
    }, "strip", import("zod").ZodTypeAny, {
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
    handler: typeof import("./tasks.js").taskDelete;
} | {
    name: string;
    description: string;
    inputSchema: import("zod").ZodObject<{
        ball: import("zod").ZodOptional<import("zod").ZodEnum<["client", "internal"]>>;
        status: import("zod").ZodOptional<import("zod").ZodEnum<["backlog", "todo", "in_progress", "in_review", "done", "considering"]>>;
        clientScope: import("zod").ZodOptional<import("zod").ZodEnum<["deliverable", "internal"]>>;
        limit: import("zod").ZodDefault<import("zod").ZodNumber>;
    }, "strip", import("zod").ZodTypeAny, {
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
    handler: typeof import("./tasks.js").taskListMy;
} | {
    name: string;
    description: string;
    inputSchema: import("zod").ZodObject<{
        spaceId: import("zod").ZodString;
        staleDays: import("zod").ZodDefault<import("zod").ZodNumber>;
        ball: import("zod").ZodOptional<import("zod").ZodEnum<["client", "internal"]>>;
        limit: import("zod").ZodDefault<import("zod").ZodNumber>;
    }, "strip", import("zod").ZodTypeAny, {
        spaceId: string;
        limit: number;
        staleDays: number;
        ball?: "client" | "internal" | undefined;
    }, {
        spaceId: string;
        ball?: "client" | "internal" | undefined;
        limit?: number | undefined;
        staleDays?: number | undefined;
    }>;
    handler: typeof import("./tasks.js").taskStale;
} | {
    name: string;
    description: string;
    inputSchema: import("zod").ZodObject<{
        spaceId: import("zod").ZodString;
        taskId: import("zod").ZodString;
        ball: import("zod").ZodEnum<["client", "internal"]>;
        clientOwnerIds: import("zod").ZodDefault<import("zod").ZodArray<import("zod").ZodString, "many">>;
        internalOwnerIds: import("zod").ZodDefault<import("zod").ZodArray<import("zod").ZodString, "many">>;
        reason: import("zod").ZodOptional<import("zod").ZodString>;
    }, "strip", import("zod").ZodTypeAny, {
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
    handler: typeof import("./ball.js").ballPass;
} | {
    name: string;
    description: string;
    inputSchema: import("zod").ZodObject<{
        spaceId: import("zod").ZodString;
        ball: import("zod").ZodEnum<["client", "internal"]>;
        includeOwners: import("zod").ZodDefault<import("zod").ZodBoolean>;
        limit: import("zod").ZodDefault<import("zod").ZodNumber>;
    }, "strip", import("zod").ZodTypeAny, {
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
    handler: typeof import("./ball.js").ballQuery;
} | {
    name: string;
    description: string;
    inputSchema: import("zod").ZodObject<{
        spaceId: import("zod").ZodString;
    }, "strip", import("zod").ZodTypeAny, {
        spaceId: string;
    }, {
        spaceId: string;
    }>;
    handler: typeof import("./ball.js").dashboardGet;
} | {
    name: string;
    description: string;
    inputSchema: import("zod").ZodObject<{
        spaceId: import("zod").ZodString;
        title: import("zod").ZodString;
        heldAt: import("zod").ZodOptional<import("zod").ZodString>;
        notes: import("zod").ZodOptional<import("zod").ZodString>;
        participantIds: import("zod").ZodDefault<import("zod").ZodArray<import("zod").ZodString, "many">>;
    }, "strip", import("zod").ZodTypeAny, {
        spaceId: string;
        title: string;
        participantIds: string[];
        heldAt?: string | undefined;
        notes?: string | undefined;
    }, {
        spaceId: string;
        title: string;
        heldAt?: string | undefined;
        notes?: string | undefined;
        participantIds?: string[] | undefined;
    }>;
    handler: typeof import("./meetings.js").meetingCreate;
} | {
    name: string;
    description: string;
    inputSchema: import("zod").ZodObject<{
        spaceId: import("zod").ZodString;
        meetingId: import("zod").ZodString;
    }, "strip", import("zod").ZodTypeAny, {
        spaceId: string;
        meetingId: string;
    }, {
        spaceId: string;
        meetingId: string;
    }>;
    handler: typeof import("./meetings.js").meetingStart;
} | {
    name: string;
    description: string;
    inputSchema: import("zod").ZodObject<{
        spaceId: import("zod").ZodString;
        status: import("zod").ZodOptional<import("zod").ZodEnum<["planned", "in_progress", "ended"]>>;
        limit: import("zod").ZodDefault<import("zod").ZodNumber>;
    }, "strip", import("zod").ZodTypeAny, {
        spaceId: string;
        limit: number;
        status?: "in_progress" | "planned" | "ended" | undefined;
    }, {
        spaceId: string;
        status?: "in_progress" | "planned" | "ended" | undefined;
        limit?: number | undefined;
    }>;
    handler: typeof import("./meetings.js").meetingList;
} | {
    name: string;
    description: string;
    inputSchema: import("zod").ZodObject<{
        spaceId: import("zod").ZodString;
        meetingId: import("zod").ZodString;
    }, "strip", import("zod").ZodTypeAny, {
        spaceId: string;
        meetingId: string;
    }, {
        spaceId: string;
        meetingId: string;
    }>;
    handler: typeof import("./meetings.js").meetingGet;
} | {
    name: string;
    description: string;
    inputSchema: import("zod").ZodObject<{
        spaceId: import("zod").ZodString;
        taskId: import("zod").ZodString;
        reviewerIds: import("zod").ZodArray<import("zod").ZodString, "many">;
    }, "strip", import("zod").ZodTypeAny, {
        spaceId: string;
        taskId: string;
        reviewerIds: string[];
    }, {
        spaceId: string;
        taskId: string;
        reviewerIds: string[];
    }>;
    handler: typeof import("./reviews.js").reviewOpen;
} | {
    name: string;
    description: string;
    inputSchema: import("zod").ZodObject<{
        spaceId: import("zod").ZodString;
        taskId: import("zod").ZodString;
    }, "strip", import("zod").ZodTypeAny, {
        spaceId: string;
        taskId: string;
    }, {
        spaceId: string;
        taskId: string;
    }>;
    handler: typeof import("./reviews.js").reviewApprove;
} | {
    name: string;
    description: string;
    inputSchema: import("zod").ZodObject<{
        spaceId: import("zod").ZodString;
        taskId: import("zod").ZodString;
        reason: import("zod").ZodString;
    }, "strip", import("zod").ZodTypeAny, {
        spaceId: string;
        reason: string;
        taskId: string;
    }, {
        spaceId: string;
        reason: string;
        taskId: string;
    }>;
    handler: typeof import("./reviews.js").reviewBlock;
} | {
    name: string;
    description: string;
    inputSchema: import("zod").ZodObject<{
        spaceId: import("zod").ZodString;
        status: import("zod").ZodOptional<import("zod").ZodEnum<["open", "approved", "changes_requested"]>>;
        limit: import("zod").ZodDefault<import("zod").ZodNumber>;
    }, "strip", import("zod").ZodTypeAny, {
        spaceId: string;
        limit: number;
        status?: "open" | "approved" | "changes_requested" | undefined;
    }, {
        spaceId: string;
        status?: "open" | "approved" | "changes_requested" | undefined;
        limit?: number | undefined;
    }>;
    handler: typeof import("./reviews.js").reviewList;
} | {
    name: string;
    description: string;
    inputSchema: import("zod").ZodObject<{
        spaceId: import("zod").ZodString;
        taskId: import("zod").ZodString;
    }, "strip", import("zod").ZodTypeAny, {
        spaceId: string;
        taskId: string;
    }, {
        spaceId: string;
        taskId: string;
    }>;
    handler: typeof import("./reviews.js").reviewGet;
} | {
    name: string;
    description: string;
    inputSchema: import("zod").ZodObject<{
        spaceId: import("zod").ZodString;
        name: import("zod").ZodString;
        dueDate: import("zod").ZodOptional<import("zod").ZodString>;
    }, "strip", import("zod").ZodTypeAny, {
        spaceId: string;
        name: string;
        dueDate?: string | undefined;
    }, {
        spaceId: string;
        name: string;
        dueDate?: string | undefined;
    }>;
    handler: typeof import("./milestones.js").milestoneCreate;
} | {
    name: string;
    description: string;
    inputSchema: import("zod").ZodObject<{
        spaceId: import("zod").ZodString;
        milestoneId: import("zod").ZodString;
        name: import("zod").ZodOptional<import("zod").ZodString>;
        dueDate: import("zod").ZodOptional<import("zod").ZodString>;
        orderKey: import("zod").ZodOptional<import("zod").ZodNumber>;
    }, "strip", import("zod").ZodTypeAny, {
        spaceId: string;
        milestoneId: string;
        dueDate?: string | undefined;
        name?: string | undefined;
        orderKey?: number | undefined;
    }, {
        spaceId: string;
        milestoneId: string;
        dueDate?: string | undefined;
        name?: string | undefined;
        orderKey?: number | undefined;
    }>;
    handler: typeof import("./milestones.js").milestoneUpdate;
} | {
    name: string;
    description: string;
    inputSchema: import("zod").ZodObject<{
        spaceId: import("zod").ZodString;
    }, "strip", import("zod").ZodTypeAny, {
        spaceId: string;
    }, {
        spaceId: string;
    }>;
    handler: typeof import("./milestones.js").milestoneList;
} | {
    name: string;
    description: string;
    inputSchema: import("zod").ZodObject<{
        spaceId: import("zod").ZodString;
        milestoneId: import("zod").ZodString;
    }, "strip", import("zod").ZodTypeAny, {
        spaceId: string;
        milestoneId: string;
    }, {
        spaceId: string;
        milestoneId: string;
    }>;
    handler: typeof import("./milestones.js").milestoneGet;
} | {
    name: string;
    description: string;
    inputSchema: import("zod").ZodObject<{
        spaceId: import("zod").ZodString;
        milestoneId: import("zod").ZodString;
    }, "strip", import("zod").ZodTypeAny, {
        spaceId: string;
        milestoneId: string;
    }, {
        spaceId: string;
        milestoneId: string;
    }>;
    handler: typeof import("./milestones.js").milestoneDelete;
} | {
    name: string;
    description: string;
    inputSchema: import("zod").ZodObject<{
        name: import("zod").ZodString;
        type: import("zod").ZodDefault<import("zod").ZodEnum<["project", "personal"]>>;
    }, "strip", import("zod").ZodTypeAny, {
        type: "project" | "personal";
        name: string;
    }, {
        name: string;
        type?: "project" | "personal" | undefined;
    }>;
    handler: typeof import("./spaces.js").spaceCreate;
} | {
    name: string;
    description: string;
    inputSchema: import("zod").ZodObject<{
        spaceId: import("zod").ZodString;
        name: import("zod").ZodOptional<import("zod").ZodString>;
    }, "strip", import("zod").ZodTypeAny, {
        spaceId: string;
        name?: string | undefined;
    }, {
        spaceId: string;
        name?: string | undefined;
    }>;
    handler: typeof import("./spaces.js").spaceUpdate;
} | {
    name: string;
    description: string;
    inputSchema: import("zod").ZodObject<{
        type: import("zod").ZodOptional<import("zod").ZodEnum<["project", "personal"]>>;
    }, "strip", import("zod").ZodTypeAny, {
        type?: "project" | "personal" | undefined;
    }, {
        type?: "project" | "personal" | undefined;
    }>;
    handler: typeof import("./spaces.js").spaceList;
} | {
    name: string;
    description: string;
    inputSchema: import("zod").ZodObject<{
        spaceId: import("zod").ZodString;
    }, "strip", import("zod").ZodTypeAny, {
        spaceId: string;
    }, {
        spaceId: string;
    }>;
    handler: typeof import("./spaces.js").spaceGet;
} | {
    name: string;
    description: string;
    inputSchema: import("zod").ZodObject<{
        spaceId: import("zod").ZodString;
        entityTable: import("zod").ZodString;
        entityId: import("zod").ZodString;
        action: import("zod").ZodString;
        actorType: import("zod").ZodDefault<import("zod").ZodEnum<["user", "system", "ai", "service"]>>;
        actorService: import("zod").ZodOptional<import("zod").ZodString>;
        requestId: import("zod").ZodOptional<import("zod").ZodString>;
        sessionId: import("zod").ZodOptional<import("zod").ZodString>;
        entityDisplay: import("zod").ZodOptional<import("zod").ZodString>;
        reason: import("zod").ZodOptional<import("zod").ZodString>;
        status: import("zod").ZodDefault<import("zod").ZodEnum<["ok", "error", "warning"]>>;
        changedFields: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodString, "many">>;
        beforeData: import("zod").ZodOptional<import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodUnknown>>;
        afterData: import("zod").ZodOptional<import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodUnknown>>;
        payload: import("zod").ZodOptional<import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodUnknown>>;
    }, "strip", import("zod").ZodTypeAny, {
        spaceId: string;
        action: string;
        status: "error" | "ok" | "warning";
        entityTable: string;
        entityId: string;
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
        spaceId: string;
        action: string;
        entityTable: string;
        entityId: string;
        reason?: string | undefined;
        status?: "error" | "ok" | "warning" | undefined;
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
    handler: typeof import("./activity.js").activityLog;
} | {
    name: string;
    description: string;
    inputSchema: import("zod").ZodObject<{
        spaceId: import("zod").ZodString;
        entityTable: import("zod").ZodOptional<import("zod").ZodString>;
        entityId: import("zod").ZodOptional<import("zod").ZodString>;
        actorId: import("zod").ZodOptional<import("zod").ZodString>;
        action: import("zod").ZodOptional<import("zod").ZodString>;
        from: import("zod").ZodOptional<import("zod").ZodString>;
        to: import("zod").ZodOptional<import("zod").ZodString>;
        sessionId: import("zod").ZodOptional<import("zod").ZodString>;
        limit: import("zod").ZodDefault<import("zod").ZodNumber>;
    }, "strip", import("zod").ZodTypeAny, {
        spaceId: string;
        limit: number;
        action?: string | undefined;
        entityTable?: string | undefined;
        entityId?: string | undefined;
        sessionId?: string | undefined;
        actorId?: string | undefined;
        from?: string | undefined;
        to?: string | undefined;
    }, {
        spaceId: string;
        action?: string | undefined;
        limit?: number | undefined;
        entityTable?: string | undefined;
        entityId?: string | undefined;
        sessionId?: string | undefined;
        actorId?: string | undefined;
        from?: string | undefined;
        to?: string | undefined;
    }>;
    handler: typeof import("./activity.js").activitySearch;
} | {
    name: string;
    description: string;
    inputSchema: import("zod").ZodObject<{
        entityTable: import("zod").ZodString;
        entityId: import("zod").ZodString;
        limit: import("zod").ZodDefault<import("zod").ZodNumber>;
    }, "strip", import("zod").ZodTypeAny, {
        limit: number;
        entityTable: string;
        entityId: string;
    }, {
        entityTable: string;
        entityId: string;
        limit?: number | undefined;
    }>;
    handler: typeof import("./activity.js").activityEntityHistory;
} | {
    name: string;
    description: string;
    inputSchema: import("zod").ZodObject<{
        email: import("zod").ZodString;
        spaceId: import("zod").ZodString;
        expiresInDays: import("zod").ZodDefault<import("zod").ZodNumber>;
    }, "strip", import("zod").ZodTypeAny, {
        spaceId: string;
        email: string;
        expiresInDays: number;
    }, {
        spaceId: string;
        email: string;
        expiresInDays?: number | undefined;
    }>;
    handler: typeof import("./clients.js").clientInviteCreate;
} | {
    name: string;
    description: string;
    inputSchema: import("zod").ZodObject<{
        emails: import("zod").ZodArray<import("zod").ZodString, "many">;
        spaceId: import("zod").ZodString;
        expiresInDays: import("zod").ZodDefault<import("zod").ZodNumber>;
    }, "strip", import("zod").ZodTypeAny, {
        spaceId: string;
        expiresInDays: number;
        emails: string[];
    }, {
        spaceId: string;
        emails: string[];
        expiresInDays?: number | undefined;
    }>;
    handler: typeof import("./clients.js").clientInviteBulkCreate;
} | {
    name: string;
    description: string;
    inputSchema: import("zod").ZodObject<{
        spaceId: import("zod").ZodOptional<import("zod").ZodString>;
        includeInvites: import("zod").ZodDefault<import("zod").ZodBoolean>;
    }, "strip", import("zod").ZodTypeAny, {
        includeInvites: boolean;
        spaceId?: string | undefined;
    }, {
        spaceId?: string | undefined;
        includeInvites?: boolean | undefined;
    }>;
    handler: typeof import("./clients.js").clientList;
} | {
    name: string;
    description: string;
    inputSchema: import("zod").ZodObject<{
        userId: import("zod").ZodString;
    }, "strip", import("zod").ZodTypeAny, {
        userId: string;
    }, {
        userId: string;
    }>;
    handler: typeof import("./clients.js").clientGet;
} | {
    name: string;
    description: string;
    inputSchema: import("zod").ZodObject<{
        userId: import("zod").ZodString;
        spaceId: import("zod").ZodString;
        role: import("zod").ZodEnum<["client", "viewer"]>;
    }, "strip", import("zod").ZodTypeAny, {
        spaceId: string;
        role: "client" | "viewer";
        userId: string;
    }, {
        spaceId: string;
        role: "client" | "viewer";
        userId: string;
    }>;
    handler: typeof import("./clients.js").clientUpdate;
} | {
    name: string;
    description: string;
    inputSchema: import("zod").ZodObject<{
        userId: import("zod").ZodString;
        spaceId: import("zod").ZodString;
        role: import("zod").ZodDefault<import("zod").ZodEnum<["client", "viewer"]>>;
    }, "strip", import("zod").ZodTypeAny, {
        spaceId: string;
        role: "client" | "viewer";
        userId: string;
    }, {
        spaceId: string;
        userId: string;
        role?: "client" | "viewer" | undefined;
    }>;
    handler: typeof import("./clients.js").clientAddToSpace;
} | {
    name: string;
    description: string;
    inputSchema: import("zod").ZodObject<{
        spaceId: import("zod").ZodOptional<import("zod").ZodString>;
        status: import("zod").ZodDefault<import("zod").ZodEnum<["pending", "accepted", "expired", "all"]>>;
    }, "strip", import("zod").ZodTypeAny, {
        status: "pending" | "accepted" | "expired" | "all";
        spaceId?: string | undefined;
    }, {
        spaceId?: string | undefined;
        status?: "pending" | "accepted" | "expired" | "all" | undefined;
    }>;
    handler: typeof import("./clients.js").clientInviteList;
} | {
    name: string;
    description: string;
    inputSchema: import("zod").ZodObject<{
        inviteId: import("zod").ZodString;
        expiresInDays: import("zod").ZodDefault<import("zod").ZodNumber>;
    }, "strip", import("zod").ZodTypeAny, {
        expiresInDays: number;
        inviteId: string;
    }, {
        inviteId: string;
        expiresInDays?: number | undefined;
    }>;
    handler: typeof import("./clients.js").clientInviteResend;
} | {
    name: string;
    description: string;
    inputSchema: import("zod").ZodObject<{
        spaceId: import("zod").ZodString;
        limit: import("zod").ZodDefault<import("zod").ZodNumber>;
    }, "strip", import("zod").ZodTypeAny, {
        spaceId: string;
        limit: number;
    }, {
        spaceId: string;
        limit?: number | undefined;
    }>;
    handler: typeof import("./wiki.js").wikiList;
} | {
    name: string;
    description: string;
    inputSchema: import("zod").ZodObject<{
        spaceId: import("zod").ZodString;
        pageId: import("zod").ZodString;
    }, "strip", import("zod").ZodTypeAny, {
        spaceId: string;
        pageId: string;
    }, {
        spaceId: string;
        pageId: string;
    }>;
    handler: typeof import("./wiki.js").wikiGet;
} | {
    name: string;
    description: string;
    inputSchema: import("zod").ZodObject<{
        spaceId: import("zod").ZodString;
        title: import("zod").ZodString;
        body: import("zod").ZodOptional<import("zod").ZodString>;
        tags: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodString, "many">>;
    }, "strip", import("zod").ZodTypeAny, {
        spaceId: string;
        title: string;
        body?: string | undefined;
        tags?: string[] | undefined;
    }, {
        spaceId: string;
        title: string;
        body?: string | undefined;
        tags?: string[] | undefined;
    }>;
    handler: typeof import("./wiki.js").wikiCreate;
} | {
    name: string;
    description: string;
    inputSchema: import("zod").ZodObject<{
        spaceId: import("zod").ZodString;
        pageId: import("zod").ZodString;
        title: import("zod").ZodOptional<import("zod").ZodString>;
        body: import("zod").ZodOptional<import("zod").ZodString>;
        tags: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodString, "many">>;
    }, "strip", import("zod").ZodTypeAny, {
        spaceId: string;
        pageId: string;
        title?: string | undefined;
        body?: string | undefined;
        tags?: string[] | undefined;
    }, {
        spaceId: string;
        pageId: string;
        title?: string | undefined;
        body?: string | undefined;
        tags?: string[] | undefined;
    }>;
    handler: typeof import("./wiki.js").wikiUpdate;
} | {
    name: string;
    description: string;
    inputSchema: import("zod").ZodObject<{
        spaceId: import("zod").ZodString;
        pageId: import("zod").ZodString;
    }, "strip", import("zod").ZodTypeAny, {
        spaceId: string;
        pageId: string;
    }, {
        spaceId: string;
        pageId: string;
    }>;
    handler: typeof import("./wiki.js").wikiDelete;
} | {
    name: string;
    description: string;
    inputSchema: import("zod").ZodObject<{
        spaceId: import("zod").ZodString;
        pageId: import("zod").ZodString;
        limit: import("zod").ZodDefault<import("zod").ZodNumber>;
    }, "strip", import("zod").ZodTypeAny, {
        spaceId: string;
        limit: number;
        pageId: string;
    }, {
        spaceId: string;
        pageId: string;
        limit?: number | undefined;
    }>;
    handler: typeof import("./wiki.js").wikiVersions;
} | {
    name: string;
    description: string;
    inputSchema: import("zod").ZodObject<{
        spaceId: import("zod").ZodString;
        meetingId: import("zod").ZodString;
    }, "strip", import("zod").ZodTypeAny, {
        spaceId: string;
        meetingId: string;
    }, {
        spaceId: string;
        meetingId: string;
    }>;
    handler: typeof import("./minutes.js").minutesGet;
} | {
    name: string;
    description: string;
    inputSchema: import("zod").ZodObject<{
        spaceId: import("zod").ZodString;
        meetingId: import("zod").ZodString;
        minutesMd: import("zod").ZodString;
    }, "strip", import("zod").ZodTypeAny, {
        spaceId: string;
        meetingId: string;
        minutesMd: string;
    }, {
        spaceId: string;
        meetingId: string;
        minutesMd: string;
    }>;
    handler: typeof import("./minutes.js").minutesUpdate;
} | {
    name: string;
    description: string;
    inputSchema: import("zod").ZodObject<{
        spaceId: import("zod").ZodString;
        meetingId: import("zod").ZodString;
        content: import("zod").ZodString;
    }, "strip", import("zod").ZodTypeAny, {
        spaceId: string;
        meetingId: string;
        content: string;
    }, {
        spaceId: string;
        meetingId: string;
        content: string;
    }>;
    handler: typeof import("./minutes.js").minutesAppend;
} | {
    name: string;
    description: string;
    inputSchema: import("zod").ZodObject<{
        spaceId: import("zod").ZodString;
        status: import("zod").ZodOptional<import("zod").ZodEnum<["open", "confirmed", "cancelled", "expired"]>>;
        limit: import("zod").ZodDefault<import("zod").ZodNumber>;
    }, "strip", import("zod").ZodTypeAny, {
        spaceId: string;
        limit: number;
        status?: "open" | "expired" | "confirmed" | "cancelled" | undefined;
    }, {
        spaceId: string;
        status?: "open" | "expired" | "confirmed" | "cancelled" | undefined;
        limit?: number | undefined;
    }>;
    handler: typeof import("./scheduling.js").schedulingList;
} | {
    name: string;
    description: string;
    inputSchema: import("zod").ZodObject<{
        spaceId: import("zod").ZodString;
        title: import("zod").ZodString;
        description: import("zod").ZodOptional<import("zod").ZodString>;
        durationMinutes: import("zod").ZodDefault<import("zod").ZodNumber>;
        slots: import("zod").ZodArray<import("zod").ZodObject<{
            startAt: import("zod").ZodString;
            endAt: import("zod").ZodString;
        }, "strip", import("zod").ZodTypeAny, {
            startAt: string;
            endAt: string;
        }, {
            startAt: string;
            endAt: string;
        }>, "many">;
        respondents: import("zod").ZodArray<import("zod").ZodObject<{
            userId: import("zod").ZodString;
            side: import("zod").ZodEnum<["client", "internal"]>;
            isRequired: import("zod").ZodDefault<import("zod").ZodBoolean>;
        }, "strip", import("zod").ZodTypeAny, {
            side: "client" | "internal";
            userId: string;
            isRequired: boolean;
        }, {
            side: "client" | "internal";
            userId: string;
            isRequired?: boolean | undefined;
        }>, "many">;
        expiresAt: import("zod").ZodOptional<import("zod").ZodString>;
        videoProvider: import("zod").ZodOptional<import("zod").ZodEnum<["google_meet", "zoom", "teams"]>>;
    }, "strip", import("zod").ZodTypeAny, {
        spaceId: string;
        title: string;
        durationMinutes: number;
        slots: {
            startAt: string;
            endAt: string;
        }[];
        respondents: {
            side: "client" | "internal";
            userId: string;
            isRequired: boolean;
        }[];
        description?: string | undefined;
        expiresAt?: string | undefined;
        videoProvider?: "google_meet" | "zoom" | "teams" | undefined;
    }, {
        spaceId: string;
        title: string;
        slots: {
            startAt: string;
            endAt: string;
        }[];
        respondents: {
            side: "client" | "internal";
            userId: string;
            isRequired?: boolean | undefined;
        }[];
        description?: string | undefined;
        durationMinutes?: number | undefined;
        expiresAt?: string | undefined;
        videoProvider?: "google_meet" | "zoom" | "teams" | undefined;
    }>;
    handler: typeof import("./scheduling.js").schedulingCreate;
} | {
    name: string;
    description: string;
    inputSchema: import("zod").ZodObject<{
        spaceId: import("zod").ZodString;
        proposalId: import("zod").ZodString;
        responses: import("zod").ZodArray<import("zod").ZodObject<{
            slotId: import("zod").ZodString;
            response: import("zod").ZodEnum<["available", "unavailable_but_proceed", "unavailable"]>;
        }, "strip", import("zod").ZodTypeAny, {
            slotId: string;
            response: "available" | "unavailable_but_proceed" | "unavailable";
        }, {
            slotId: string;
            response: "available" | "unavailable_but_proceed" | "unavailable";
        }>, "many">;
    }, "strip", import("zod").ZodTypeAny, {
        spaceId: string;
        proposalId: string;
        responses: {
            slotId: string;
            response: "available" | "unavailable_but_proceed" | "unavailable";
        }[];
    }, {
        spaceId: string;
        proposalId: string;
        responses: {
            slotId: string;
            response: "available" | "unavailable_but_proceed" | "unavailable";
        }[];
    }>;
    handler: typeof import("./scheduling.js").schedulingRespond;
} | {
    name: string;
    description: string;
    inputSchema: import("zod").ZodObject<{
        spaceId: import("zod").ZodString;
        proposalId: import("zod").ZodString;
        slotId: import("zod").ZodString;
    }, "strip", import("zod").ZodTypeAny, {
        spaceId: string;
        proposalId: string;
        slotId: string;
    }, {
        spaceId: string;
        proposalId: string;
        slotId: string;
    }>;
    handler: typeof import("./scheduling.js").schedulingConfirm;
} | {
    name: string;
    description: string;
    inputSchema: import("zod").ZodObject<{
        spaceId: import("zod").ZodString;
        proposalId: import("zod").ZodString;
        action: import("zod").ZodEnum<["cancel", "extend"]>;
        newExpiresAt: import("zod").ZodOptional<import("zod").ZodString>;
    }, "strip", import("zod").ZodTypeAny, {
        spaceId: string;
        action: "cancel" | "extend";
        proposalId: string;
        newExpiresAt?: string | undefined;
    }, {
        spaceId: string;
        action: "cancel" | "extend";
        proposalId: string;
        newExpiresAt?: string | undefined;
    }>;
    handler: typeof import("./scheduling.js").schedulingCancel;
} | {
    name: string;
    description: string;
    inputSchema: import("zod").ZodObject<{
        spaceId: import("zod").ZodString;
        proposalId: import("zod").ZodString;
    }, "strip", import("zod").ZodTypeAny, {
        spaceId: string;
        proposalId: string;
    }, {
        spaceId: string;
        proposalId: string;
    }>;
    handler: typeof import("./scheduling.js").schedulingGetResponses;
} | {
    name: string;
    description: string;
    inputSchema: import("zod").ZodObject<{
        spaceId: import("zod").ZodString;
        userIds: import("zod").ZodArray<import("zod").ZodString, "many">;
        startDate: import("zod").ZodString;
        endDate: import("zod").ZodString;
        durationMinutes: import("zod").ZodDefault<import("zod").ZodNumber>;
        businessHourStart: import("zod").ZodDefault<import("zod").ZodNumber>;
        businessHourEnd: import("zod").ZodDefault<import("zod").ZodNumber>;
    }, "strip", import("zod").ZodTypeAny, {
        spaceId: string;
        startDate: string;
        durationMinutes: number;
        userIds: string[];
        endDate: string;
        businessHourStart: number;
        businessHourEnd: number;
    }, {
        spaceId: string;
        startDate: string;
        userIds: string[];
        endDate: string;
        durationMinutes?: number | undefined;
        businessHourStart?: number | undefined;
        businessHourEnd?: number | undefined;
    }>;
    handler: typeof import("./scheduling.js").schedulingSuggestSlots;
} | {
    name: string;
    description: string;
    inputSchema: import("zod").ZodObject<{
        spaceId: import("zod").ZodString;
        proposalId: import("zod").ZodString;
    }, "strip", import("zod").ZodTypeAny, {
        spaceId: string;
        proposalId: string;
    }, {
        spaceId: string;
        proposalId: string;
    }>;
    handler: typeof import("./scheduling.js").schedulingSendReminder;
})[];
export declare function registerTools(server: Server): void;
//# sourceMappingURL=index.d.ts.map