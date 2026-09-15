import { z } from 'zod';
/**
 * 「決定事項のタスク」を確定させる道具。画面のタスク詳細にある「決定にする」と同じもの。
 *
 * 確定の単位はページ全体ではなく決定1件。決定すると、紐づく Wiki ページに
 * 「決定: <タスクの題名> (日付)」が書き足され、書き足す前の本文が「確定時点の控え」として
 * 残る（`kind='decided'` の印付き）。詳しくは docs/spec/DECISION_RECORD_SPEC.md。
 */
declare const DECISION_STATES: readonly ["considering", "decided", "implemented"];
export declare const specDecideSchema: z.ZodObject<{
    spaceId: z.ZodString;
    taskId: z.ZodString;
    state: z.ZodEnum<["considering", "decided", "implemented"]>;
    note: z.ZodOptional<z.ZodString>;
    meetingId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    taskId: string;
    state: "considering" | "decided" | "implemented";
    meetingId?: string | undefined;
    note?: string | undefined;
}, {
    spaceId: string;
    taskId: string;
    state: "considering" | "decided" | "implemented";
    meetingId?: string | undefined;
    note?: string | undefined;
}>;
export interface SpecDecideResult {
    ok: boolean;
    taskId: string;
    title: string;
    /** 変更後の決定の状態 */
    decisionState: (typeof DECISION_STATES)[number];
    /** 紐づく Wiki ページ（あれば）。決定行はこのページの末尾に入る */
    wikiPageId: string | null;
    /** そのタスクを画面で開くリンク */
    link: string;
}
export declare function specDecide(params: z.infer<typeof specDecideSchema>): Promise<SpecDecideResult>;
export declare const decisionTools: {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        spaceId: z.ZodString;
        taskId: z.ZodString;
        state: z.ZodEnum<["considering", "decided", "implemented"]>;
        note: z.ZodOptional<z.ZodString>;
        meetingId: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        spaceId: string;
        taskId: string;
        state: "considering" | "decided" | "implemented";
        meetingId?: string | undefined;
        note?: string | undefined;
    }, {
        spaceId: string;
        taskId: string;
        state: "considering" | "decided" | "implemented";
        meetingId?: string | undefined;
        note?: string | undefined;
    }>;
    handler: typeof specDecide;
}[];
export {};
//# sourceMappingURL=decisions.d.ts.map