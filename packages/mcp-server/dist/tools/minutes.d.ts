import { z } from 'zod';
import { Meeting } from '../supabase/client.js';
declare const minutesGetSchema: z.ZodObject<{
    meetingId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    meetingId: string;
}, {
    meetingId: string;
}>;
declare const minutesUpdateSchema: z.ZodObject<{
    meetingId: z.ZodString;
    minutesMd: z.ZodString;
}, "strip", z.ZodTypeAny, {
    meetingId: string;
    minutesMd: string;
}, {
    meetingId: string;
    minutesMd: string;
}>;
declare const minutesAppendSchema: z.ZodObject<{
    meetingId: z.ZodString;
    content: z.ZodString;
}, "strip", z.ZodTypeAny, {
    meetingId: string;
    content: string;
}, {
    meetingId: string;
    content: string;
}>;
export declare function minutesGet(params: z.infer<typeof minutesGetSchema>): Promise<{
    meeting_id: string;
    title: string;
    status: string;
    minutes_md: string | null;
}>;
export declare function minutesUpdate(params: z.infer<typeof minutesUpdateSchema>): Promise<Meeting>;
export declare function minutesAppend(params: z.infer<typeof minutesAppendSchema>): Promise<Meeting>;
export declare const minutesTools: ({
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        meetingId: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        meetingId: string;
    }, {
        meetingId: string;
    }>;
    handler: typeof minutesGet;
} | {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        meetingId: z.ZodString;
        minutesMd: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        meetingId: string;
        minutesMd: string;
    }, {
        meetingId: string;
        minutesMd: string;
    }>;
    handler: typeof minutesUpdate;
} | {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        meetingId: z.ZodString;
        content: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        meetingId: string;
        content: string;
    }, {
        meetingId: string;
        content: string;
    }>;
    handler: typeof minutesAppend;
})[];
export {};
//# sourceMappingURL=minutes.d.ts.map