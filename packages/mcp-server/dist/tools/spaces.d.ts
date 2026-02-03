import { z } from 'zod';
import { Space } from '../supabase/client.js';
export declare const spaceCreateSchema: z.ZodObject<{
    name: z.ZodString;
    type: z.ZodDefault<z.ZodEnum<["project", "personal"]>>;
}, "strip", z.ZodTypeAny, {
    type: "project" | "personal";
    name: string;
}, {
    name: string;
    type?: "project" | "personal" | undefined;
}>;
export declare const spaceUpdateSchema: z.ZodObject<{
    spaceId: z.ZodString;
    name: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    name?: string | undefined;
}, {
    spaceId: string;
    name?: string | undefined;
}>;
export declare const spaceListSchema: z.ZodObject<{
    type: z.ZodOptional<z.ZodEnum<["project", "personal"]>>;
}, "strip", z.ZodTypeAny, {
    type?: "project" | "personal" | undefined;
}, {
    type?: "project" | "personal" | undefined;
}>;
export declare const spaceGetSchema: z.ZodObject<{
    spaceId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
}, {
    spaceId: string;
}>;
export declare function spaceCreate(params: z.infer<typeof spaceCreateSchema>): Promise<Space>;
export declare function spaceUpdate(params: z.infer<typeof spaceUpdateSchema>): Promise<Space>;
export declare function spaceList(params: z.infer<typeof spaceListSchema>): Promise<Space[]>;
export declare function spaceGet(params: z.infer<typeof spaceGetSchema>): Promise<Space>;
export declare const spaceTools: ({
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        name: z.ZodString;
        type: z.ZodDefault<z.ZodEnum<["project", "personal"]>>;
    }, "strip", z.ZodTypeAny, {
        type: "project" | "personal";
        name: string;
    }, {
        name: string;
        type?: "project" | "personal" | undefined;
    }>;
    handler: typeof spaceCreate;
} | {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        spaceId: z.ZodString;
        name: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        spaceId: string;
        name?: string | undefined;
    }, {
        spaceId: string;
        name?: string | undefined;
    }>;
    handler: typeof spaceUpdate;
} | {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        type: z.ZodOptional<z.ZodEnum<["project", "personal"]>>;
    }, "strip", z.ZodTypeAny, {
        type?: "project" | "personal" | undefined;
    }, {
        type?: "project" | "personal" | undefined;
    }>;
    handler: typeof spaceList;
} | {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        spaceId: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        spaceId: string;
    }, {
        spaceId: string;
    }>;
    handler: typeof spaceGet;
})[];
//# sourceMappingURL=spaces.d.ts.map