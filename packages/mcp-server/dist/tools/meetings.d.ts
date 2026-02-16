import { z } from 'zod';
import { Meeting } from '../supabase/client.js';
export declare const meetingCreateSchema: z.ZodObject<{
    spaceId: z.ZodString;
    title: z.ZodString;
    heldAt: z.ZodOptional<z.ZodString>;
    notes: z.ZodOptional<z.ZodString>;
    participantIds: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
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
export declare const meetingStartSchema: z.ZodObject<{
    spaceId: z.ZodString;
    meetingId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    meetingId: string;
}, {
    spaceId: string;
    meetingId: string;
}>;
export declare const meetingEndSchema: z.ZodObject<{
    spaceId: z.ZodString;
    meetingId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    meetingId: string;
}, {
    spaceId: string;
    meetingId: string;
}>;
export declare const meetingListSchema: z.ZodObject<{
    spaceId: z.ZodString;
    status: z.ZodOptional<z.ZodEnum<["planned", "in_progress", "ended"]>>;
    limit: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    limit: number;
    status?: "in_progress" | "planned" | "ended" | undefined;
}, {
    spaceId: string;
    status?: "in_progress" | "planned" | "ended" | undefined;
    limit?: number | undefined;
}>;
export declare const meetingGetSchema: z.ZodObject<{
    spaceId: z.ZodString;
    meetingId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    meetingId: string;
}, {
    spaceId: string;
    meetingId: string;
}>;
export declare function meetingCreate(params: z.infer<typeof meetingCreateSchema>): Promise<Meeting>;
export declare function meetingStart(params: z.infer<typeof meetingStartSchema>): Promise<{
    ok: boolean;
    meeting: Meeting;
}>;
export interface MeetingEndResult {
    ok: boolean;
    meeting: Meeting;
    summary: {
        subject: string;
        body: string;
        counts: {
            decided: number;
            open: number;
            ball_client: number;
        };
    };
}
export declare function meetingEnd(params: z.infer<typeof meetingEndSchema>): Promise<MeetingEndResult>;
export declare function meetingList(params: z.infer<typeof meetingListSchema>): Promise<Meeting[]>;
export declare function meetingGet(params: z.infer<typeof meetingGetSchema>): Promise<{
    meeting: Meeting;
    participants: {
        user_id: string;
        side: string;
    }[];
}>;
export declare const meetingTools: ({
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        spaceId: z.ZodString;
        title: z.ZodString;
        heldAt: z.ZodOptional<z.ZodString>;
        notes: z.ZodOptional<z.ZodString>;
        participantIds: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
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
    handler: typeof meetingCreate;
} | {
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
    handler: typeof meetingStart;
} | {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        spaceId: z.ZodString;
        status: z.ZodOptional<z.ZodEnum<["planned", "in_progress", "ended"]>>;
        limit: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        spaceId: string;
        limit: number;
        status?: "in_progress" | "planned" | "ended" | undefined;
    }, {
        spaceId: string;
        status?: "in_progress" | "planned" | "ended" | undefined;
        limit?: number | undefined;
    }>;
    handler: typeof meetingList;
} | {
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
    handler: typeof meetingGet;
})[];
//# sourceMappingURL=meetings.d.ts.map