import { z } from 'zod';
export interface Review {
    id: string;
    org_id: string;
    space_id: string;
    task_id: string;
    status: 'open' | 'approved' | 'changes_requested' | 'cancelled';
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
    spaceId: z.ZodString;
    taskId: z.ZodString;
    reviewerIds: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    taskId: string;
    reviewerIds: string[];
}, {
    spaceId: string;
    taskId: string;
    reviewerIds: string[];
}>;
export declare const reviewApproveSchema: z.ZodObject<{
    spaceId: z.ZodString;
    taskId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    taskId: string;
}, {
    spaceId: string;
    taskId: string;
}>;
export declare const reviewBlockSchema: z.ZodObject<{
    spaceId: z.ZodString;
    taskId: z.ZodString;
    reason: z.ZodString;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    reason: string;
    taskId: string;
}, {
    spaceId: string;
    reason: string;
    taskId: string;
}>;
export declare const reviewCancelSchema: z.ZodObject<{
    spaceId: z.ZodString;
    taskId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    taskId: string;
}, {
    spaceId: string;
    taskId: string;
}>;
export declare const reviewListSchema: z.ZodObject<{
    spaceId: z.ZodString;
    status: z.ZodOptional<z.ZodEnum<["open", "approved", "changes_requested", "cancelled"]>>;
    limit: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    limit: number;
    status?: "open" | "approved" | "changes_requested" | "cancelled" | undefined;
}, {
    spaceId: string;
    status?: "open" | "approved" | "changes_requested" | "cancelled" | undefined;
    limit?: number | undefined;
}>;
export declare const reviewGetSchema: z.ZodObject<{
    spaceId: z.ZodString;
    taskId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    taskId: string;
}, {
    spaceId: string;
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
/**
 * 承認依頼を取り消す（画面のタスク詳細にある「レビューを取り消す」と同じ）。
 *
 * 取り消せるのは、まだ終わっていない依頼（承認待ち・差し戻し）だけ。誰が取り消せるか
 * （依頼した本人・プロジェクトの管理者・組織のオーナー）は DB 側が決める。
 * CLI が持っているのはタスクの UUID なので、対象の review はタスクから引き当てる
 * （reviews は task_id に一意制約があるので1件に定まる）。
 */
export declare function reviewCancel(params: z.infer<typeof reviewCancelSchema>): Promise<{
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
        spaceId: z.ZodString;
        taskId: z.ZodString;
        reviewerIds: z.ZodArray<z.ZodString, "many">;
    }, "strip", z.ZodTypeAny, {
        spaceId: string;
        taskId: string;
        reviewerIds: string[];
    }, {
        spaceId: string;
        taskId: string;
        reviewerIds: string[];
    }>;
    handler: typeof reviewOpen;
} | {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        spaceId: z.ZodString;
        taskId: z.ZodString;
        reason: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        spaceId: string;
        reason: string;
        taskId: string;
    }, {
        spaceId: string;
        reason: string;
        taskId: string;
    }>;
    handler: typeof reviewBlock;
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
    handler: typeof reviewCancel;
} | {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        spaceId: z.ZodString;
        status: z.ZodOptional<z.ZodEnum<["open", "approved", "changes_requested", "cancelled"]>>;
        limit: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        spaceId: string;
        limit: number;
        status?: "open" | "approved" | "changes_requested" | "cancelled" | undefined;
    }, {
        spaceId: string;
        status?: "open" | "approved" | "changes_requested" | "cancelled" | undefined;
        limit?: number | undefined;
    }>;
    handler: typeof reviewList;
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
    handler: typeof reviewGet;
})[];
//# sourceMappingURL=reviews.d.ts.map