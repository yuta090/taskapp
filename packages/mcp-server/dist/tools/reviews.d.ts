import { z } from 'zod';
export interface Review {
    id: string;
    org_id: string;
    space_id: string;
    task_id: string;
    status: 'open' | 'approved' | 'changes_requested';
    created_by: string;
    created_at: string;
    updated_at: string;
}
export interface ReviewApproval {
    id: string;
    org_id: string;
    review_id: string;
    reviewer_id: string;
    state: 'pending' | 'approved' | 'blocked';
    blocked_reason: string | null;
    created_at: string;
    updated_at: string;
}
export declare const reviewOpenSchema: z.ZodObject<{
    taskId: z.ZodString;
    reviewerIds: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    taskId: string;
    reviewerIds: string[];
}, {
    taskId: string;
    reviewerIds: string[];
}>;
export declare const reviewApproveSchema: z.ZodObject<{
    taskId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    taskId: string;
}, {
    taskId: string;
}>;
export declare const reviewBlockSchema: z.ZodObject<{
    taskId: z.ZodString;
    reason: z.ZodString;
}, "strip", z.ZodTypeAny, {
    reason: string;
    taskId: string;
}, {
    reason: string;
    taskId: string;
}>;
export declare const reviewListSchema: z.ZodObject<{
    spaceId: z.ZodOptional<z.ZodString>;
    status: z.ZodOptional<z.ZodEnum<["open", "approved", "changes_requested"]>>;
    limit: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    limit: number;
    spaceId?: string | undefined;
    status?: "open" | "approved" | "changes_requested" | undefined;
}, {
    spaceId?: string | undefined;
    status?: "open" | "approved" | "changes_requested" | undefined;
    limit?: number | undefined;
}>;
export declare const reviewGetSchema: z.ZodObject<{
    taskId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    taskId: string;
}, {
    taskId: string;
}>;
export declare function reviewOpen(params: z.infer<typeof reviewOpenSchema>): Promise<{
    ok: boolean;
    review: Review;
}>;
export declare function reviewApprove(params: z.infer<typeof reviewApproveSchema>): Promise<{
    ok: boolean;
    allApproved: boolean;
}>;
export declare function reviewBlock(params: z.infer<typeof reviewBlockSchema>): Promise<{
    ok: boolean;
}>;
export declare function reviewList(params: z.infer<typeof reviewListSchema>): Promise<Review[]>;
export declare function reviewGet(params: z.infer<typeof reviewGetSchema>): Promise<{
    review: Review | null;
    approvals: ReviewApproval[];
}>;
export declare const reviewTools: ({
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        taskId: z.ZodString;
        reviewerIds: z.ZodArray<z.ZodString, "many">;
    }, "strip", z.ZodTypeAny, {
        taskId: string;
        reviewerIds: string[];
    }, {
        taskId: string;
        reviewerIds: string[];
    }>;
    handler: typeof reviewOpen;
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
    handler: typeof reviewApprove;
} | {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        taskId: z.ZodString;
        reason: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        reason: string;
        taskId: string;
    }, {
        reason: string;
        taskId: string;
    }>;
    handler: typeof reviewBlock;
} | {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        spaceId: z.ZodOptional<z.ZodString>;
        status: z.ZodOptional<z.ZodEnum<["open", "approved", "changes_requested"]>>;
        limit: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        limit: number;
        spaceId?: string | undefined;
        status?: "open" | "approved" | "changes_requested" | undefined;
    }, {
        spaceId?: string | undefined;
        status?: "open" | "approved" | "changes_requested" | undefined;
        limit?: number | undefined;
    }>;
    handler: typeof reviewList;
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
    handler: typeof reviewGet;
})[];
//# sourceMappingURL=reviews.d.ts.map