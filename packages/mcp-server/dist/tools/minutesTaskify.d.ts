import { z } from 'zod';
export declare const minutesTaskifyPreviewSchema: z.ZodObject<{
    spaceId: z.ZodString;
    meetingId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    meetingId: string;
}, {
    spaceId: string;
    meetingId: string;
}>;
export declare const minutesTaskifySchema: z.ZodObject<{
    dryRun: z.ZodOptional<z.ZodBoolean>;
    spaceId: z.ZodString;
    meetingId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    meetingId: string;
    dryRun?: boolean | undefined;
}, {
    spaceId: string;
    meetingId: string;
    dryRun?: boolean | undefined;
}>;
export interface TaskifyCandidate {
    lineNumber: number;
    title: string;
    /** 紐づく資料の名前（Wiki のページ名。旧来の行なら仕様書のパス） */
    source: string;
    /** 決定事項のタスクになるか（決まるまで完了できない） */
    isDecision: boolean;
}
export interface TaskifyPreviewResult {
    newCount: number;
    existingCount: number;
    candidates: TaskifyCandidate[];
}
export interface TaskifyResult {
    ok: boolean;
    createdCount: number;
    created: Array<{
        taskId: string;
        title: string;
        isDecision: boolean;
        link: string;
    }>;
    /** dryRun のときだけ。作らずに数えた結果 */
    preview?: TaskifyPreviewResult;
}
export declare function minutesTaskifyPreview(params: z.infer<typeof minutesTaskifyPreviewSchema>): Promise<TaskifyPreviewResult>;
export declare function minutesTaskify(params: z.infer<typeof minutesTaskifySchema>): Promise<TaskifyResult>;
export declare const minutesTaskifyTools: ({
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        spaceId: z.ZodString;
        meetingId: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        spaceId: string;
        meetingId: string;
    }, {
        spaceId: string;
        meetingId: string;
    }>;
    handler: typeof minutesTaskifyPreview;
} | {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        dryRun: z.ZodOptional<z.ZodBoolean>;
        spaceId: z.ZodString;
        meetingId: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        spaceId: string;
        meetingId: string;
        dryRun?: boolean | undefined;
    }, {
        spaceId: string;
        meetingId: string;
        dryRun?: boolean | undefined;
    }>;
    handler: typeof minutesTaskify;
})[];
//# sourceMappingURL=minutesTaskify.d.ts.map