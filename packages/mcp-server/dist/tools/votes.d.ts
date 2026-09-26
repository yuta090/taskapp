import { z } from 'zod';
export type DocVoteChoice = 'ok' | 'ng' | 'hold';
export type DocPollReasonRequired = 'none' | 'ng_hold';
export declare const voteListSchema: z.ZodObject<{
    spaceId: z.ZodString;
    wikiPageId: z.ZodOptional<z.ZodString>;
    meetingId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    wikiPageId?: string | undefined;
    meetingId?: string | undefined;
}, {
    spaceId: string;
    wikiPageId?: string | undefined;
    meetingId?: string | undefined;
}>;
export declare const voteShowSchema: z.ZodObject<{
    spaceId: z.ZodString;
    pollId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    pollId: string;
}, {
    spaceId: string;
    pollId: string;
}>;
export declare const voteCastSchema: z.ZodObject<{
    spaceId: z.ZodString;
    pollId: z.ZodString;
    choice: z.ZodEnum<["ok", "ng", "hold", "none"]>;
    memo: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    pollId: string;
    choice: "ok" | "none" | "ng" | "hold";
    memo?: string | undefined;
}, {
    spaceId: string;
    pollId: string;
    choice: "ok" | "none" | "ng" | "hold";
    memo?: string | undefined;
}>;
export interface VoteListItem {
    pollId: string;
    topic: string;
    reasonRequired: DocPollReasonRequired;
    counts: {
        ok: number;
        ng: number;
        hold: number;
    };
}
export declare function voteList(params: z.infer<typeof voteListSchema>): Promise<VoteListItem[]>;
export interface VoteShowVote {
    userId: string;
    displayName: string;
    choice: DocVoteChoice;
    memo: string;
    updatedAt: string;
}
export interface VoteShowEvent {
    userId: string;
    displayName: string;
    action: 'cast' | 'change' | 'retract';
    choice: DocVoteChoice | null;
    memo: string;
    createdAt: string;
}
export interface VoteShowResult {
    pollId: string;
    reasonRequired: DocPollReasonRequired;
    votes: VoteShowVote[];
    history: VoteShowEvent[];
}
export declare function voteShow(params: z.infer<typeof voteShowSchema>): Promise<VoteShowResult>;
export interface VoteCastResult {
    ok: boolean;
    choice: DocVoteChoice | null;
}
export declare function voteCast(params: z.infer<typeof voteCastSchema>): Promise<VoteCastResult>;
export declare const voteTools: ({
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        spaceId: z.ZodString;
        wikiPageId: z.ZodOptional<z.ZodString>;
        meetingId: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        spaceId: string;
        wikiPageId?: string | undefined;
        meetingId?: string | undefined;
    }, {
        spaceId: string;
        wikiPageId?: string | undefined;
        meetingId?: string | undefined;
    }>;
    handler: typeof voteList;
} | {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        spaceId: z.ZodString;
        pollId: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        spaceId: string;
        pollId: string;
    }, {
        spaceId: string;
        pollId: string;
    }>;
    handler: typeof voteShow;
} | {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        spaceId: z.ZodString;
        pollId: z.ZodString;
        choice: z.ZodEnum<["ok", "ng", "hold", "none"]>;
        memo: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        spaceId: string;
        pollId: string;
        choice: "ok" | "none" | "ng" | "hold";
        memo?: string | undefined;
    }, {
        spaceId: string;
        pollId: string;
        choice: "ok" | "none" | "ng" | "hold";
        memo?: string | undefined;
    }>;
    handler: typeof voteCast;
})[];
//# sourceMappingURL=votes.d.ts.map