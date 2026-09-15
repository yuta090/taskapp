import { z } from 'zod';
export declare const minutesCompleteCheckedSchema: z.ZodObject<{
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
export interface MinutesCompleteItem {
    taskId: string;
    title: string;
    /** 'completed' = 完了にした / 'already_done' = すでに完了 / 'blocked' = できなかった */
    result: 'completed' | 'already_done' | 'blocked';
    /** できなかった理由（blocked のときだけ） */
    reason?: string;
    link: string;
}
export interface MinutesCompleteResult {
    ok: boolean;
    /** チェックが付いていて、タスクのある行の数 */
    checkedCount: number;
    completedCount: number;
    items: MinutesCompleteItem[];
    /** dryRun のときだけ true */
    dryRun?: boolean;
}
export declare function minutesCompleteChecked(params: z.infer<typeof minutesCompleteCheckedSchema>): Promise<MinutesCompleteResult>;
export declare const minutesCompleteTools: {
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
    handler: typeof minutesCompleteChecked;
}[];
//# sourceMappingURL=minutesComplete.d.ts.map