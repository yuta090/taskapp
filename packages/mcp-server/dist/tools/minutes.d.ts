import { z } from 'zod';
import { Meeting } from '../supabase/client.js';
declare const minutesGetSchema: z.ZodObject<{
    spaceId: z.ZodString;
    meetingId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    meetingId: string;
}, {
    spaceId: string;
    meetingId: string;
}>;
declare const minutesUpdateSchema: z.ZodObject<{
    spaceId: z.ZodString;
    meetingId: z.ZodString;
    minutesMd: z.ZodString;
    expectedUpdatedAt: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    meetingId: string;
    minutesMd: string;
    expectedUpdatedAt?: string | undefined;
}, {
    spaceId: string;
    meetingId: string;
    minutesMd: string;
    expectedUpdatedAt?: string | undefined;
}>;
declare const minutesAppendSchema: z.ZodObject<{
    spaceId: z.ZodString;
    meetingId: z.ZodString;
    content: z.ZodString;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    meetingId: string;
    content: string;
}, {
    spaceId: string;
    meetingId: string;
    content: string;
}>;
declare const minutesTocSchema: z.ZodObject<{
    spaceId: z.ZodString;
    meetingId: z.ZodString;
    action: z.ZodDefault<z.ZodEnum<["add", "remove"]>>;
    expectedUpdatedAt: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    action: "add" | "remove";
    meetingId: string;
    expectedUpdatedAt?: string | undefined;
}, {
    spaceId: string;
    meetingId: string;
    action?: "add" | "remove" | undefined;
    expectedUpdatedAt?: string | undefined;
}>;
export declare function minutesGet(params: z.infer<typeof minutesGetSchema>): Promise<{
    meeting_id: string;
    title: string;
    status: string;
    minutes_md: string | null;
    updated_at: string;
}>;
export declare function minutesUpdate(params: z.infer<typeof minutesUpdateSchema>): Promise<Meeting>;
export declare function minutesAppend(params: z.infer<typeof minutesAppendSchema>): Promise<Meeting>;
export declare function minutesToc(params: z.infer<typeof minutesTocSchema>): Promise<Meeting>;
export declare const minutesTools: ({
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
    handler: typeof minutesGet;
} | {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        spaceId: z.ZodString;
        meetingId: z.ZodString;
        minutesMd: z.ZodString;
        expectedUpdatedAt: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        spaceId: string;
        meetingId: string;
        minutesMd: string;
        expectedUpdatedAt?: string | undefined;
    }, {
        spaceId: string;
        meetingId: string;
        minutesMd: string;
        expectedUpdatedAt?: string | undefined;
    }>;
    handler: typeof minutesUpdate;
} | {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        spaceId: z.ZodString;
        meetingId: z.ZodString;
        content: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        spaceId: string;
        meetingId: string;
        content: string;
    }, {
        spaceId: string;
        meetingId: string;
        content: string;
    }>;
    handler: typeof minutesAppend;
} | {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        spaceId: z.ZodString;
        meetingId: z.ZodString;
        action: z.ZodDefault<z.ZodEnum<["add", "remove"]>>;
        expectedUpdatedAt: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        spaceId: string;
        action: "add" | "remove";
        meetingId: string;
        expectedUpdatedAt?: string | undefined;
    }, {
        spaceId: string;
        meetingId: string;
        action?: "add" | "remove" | undefined;
        expectedUpdatedAt?: string | undefined;
    }>;
    handler: typeof minutesToc;
})[];
export {};
//# sourceMappingURL=minutes.d.ts.map