import { z } from 'zod';
export interface Milestone {
    id: string;
    org_id: string;
    space_id: string;
    name: string;
    due_date: string | null;
    order_key: number;
    created_at: string;
    updated_at: string;
}
export declare const milestoneCreateSchema: z.ZodObject<{
    spaceId: z.ZodString;
    name: z.ZodString;
    dueDate: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    name: string;
    dueDate?: string | undefined;
}, {
    spaceId: string;
    name: string;
    dueDate?: string | undefined;
}>;
export declare const milestoneUpdateSchema: z.ZodObject<{
    spaceId: z.ZodString;
    milestoneId: z.ZodString;
    name: z.ZodOptional<z.ZodString>;
    dueDate: z.ZodOptional<z.ZodString>;
    orderKey: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    milestoneId: string;
    dueDate?: string | undefined;
    name?: string | undefined;
    orderKey?: number | undefined;
}, {
    spaceId: string;
    milestoneId: string;
    dueDate?: string | undefined;
    name?: string | undefined;
    orderKey?: number | undefined;
}>;
export declare const milestoneListSchema: z.ZodObject<{
    spaceId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
}, {
    spaceId: string;
}>;
export declare const milestoneGetSchema: z.ZodObject<{
    spaceId: z.ZodString;
    milestoneId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    milestoneId: string;
}, {
    spaceId: string;
    milestoneId: string;
}>;
export declare const milestoneDeleteSchema: z.ZodObject<{
    spaceId: z.ZodString;
    milestoneId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    milestoneId: string;
}, {
    spaceId: string;
    milestoneId: string;
}>;
export declare function milestoneCreate(params: z.infer<typeof milestoneCreateSchema>): Promise<Milestone>;
export declare function milestoneUpdate(params: z.infer<typeof milestoneUpdateSchema>): Promise<Milestone>;
export declare function milestoneList(params: z.infer<typeof milestoneListSchema>): Promise<Milestone[]>;
export declare function milestoneGet(params: z.infer<typeof milestoneGetSchema>): Promise<Milestone>;
export declare function milestoneDelete(params: z.infer<typeof milestoneDeleteSchema>): Promise<{
    success: boolean;
    milestoneId: string;
}>;
export declare const milestoneTools: ({
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        spaceId: z.ZodString;
        name: z.ZodString;
        dueDate: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        spaceId: string;
        name: string;
        dueDate?: string | undefined;
    }, {
        spaceId: string;
        name: string;
        dueDate?: string | undefined;
    }>;
    handler: typeof milestoneCreate;
} | {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        spaceId: z.ZodString;
        milestoneId: z.ZodString;
        name: z.ZodOptional<z.ZodString>;
        dueDate: z.ZodOptional<z.ZodString>;
        orderKey: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        spaceId: string;
        milestoneId: string;
        dueDate?: string | undefined;
        name?: string | undefined;
        orderKey?: number | undefined;
    }, {
        spaceId: string;
        milestoneId: string;
        dueDate?: string | undefined;
        name?: string | undefined;
        orderKey?: number | undefined;
    }>;
    handler: typeof milestoneUpdate;
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
    handler: typeof milestoneList;
} | {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        spaceId: z.ZodString;
        milestoneId: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        spaceId: string;
        milestoneId: string;
    }, {
        spaceId: string;
        milestoneId: string;
    }>;
    handler: typeof milestoneGet;
} | {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        spaceId: z.ZodString;
        milestoneId: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        spaceId: string;
        milestoneId: string;
    }, {
        spaceId: string;
        milestoneId: string;
    }>;
    handler: typeof milestoneDelete;
})[];
//# sourceMappingURL=milestones.d.ts.map