import { z } from 'zod';
import { WikiPage, WikiPageVersion } from '../supabase/client.js';
declare const wikiListSchema: z.ZodObject<{
    spaceId: z.ZodString;
    limit: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    limit: number;
}, {
    spaceId: string;
    limit?: number | undefined;
}>;
declare const wikiGetSchema: z.ZodObject<{
    spaceId: z.ZodString;
    pageId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    pageId: string;
}, {
    spaceId: string;
    pageId: string;
}>;
declare const wikiCreateSchema: z.ZodObject<{
    spaceId: z.ZodString;
    title: z.ZodString;
    body: z.ZodOptional<z.ZodString>;
    tags: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    title: string;
    body?: string | undefined;
    tags?: string[] | undefined;
}, {
    spaceId: string;
    title: string;
    body?: string | undefined;
    tags?: string[] | undefined;
}>;
declare const wikiUpdateSchema: z.ZodObject<{
    spaceId: z.ZodString;
    pageId: z.ZodString;
    title: z.ZodOptional<z.ZodString>;
    body: z.ZodOptional<z.ZodString>;
    tags: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    pageId: string;
    title?: string | undefined;
    body?: string | undefined;
    tags?: string[] | undefined;
}, {
    spaceId: string;
    pageId: string;
    title?: string | undefined;
    body?: string | undefined;
    tags?: string[] | undefined;
}>;
declare const wikiDeleteSchema: z.ZodObject<{
    spaceId: z.ZodString;
    pageId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    pageId: string;
}, {
    spaceId: string;
    pageId: string;
}>;
declare const wikiVersionsSchema: z.ZodObject<{
    spaceId: z.ZodString;
    pageId: z.ZodString;
    limit: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    limit: number;
    pageId: string;
}, {
    spaceId: string;
    pageId: string;
    limit?: number | undefined;
}>;
export declare function wikiList(params: z.infer<typeof wikiListSchema>): Promise<WikiPage[]>;
export declare function wikiGet(params: z.infer<typeof wikiGetSchema>): Promise<WikiPage>;
export declare function wikiCreate(params: z.infer<typeof wikiCreateSchema>): Promise<WikiPage>;
export declare function wikiUpdate(params: z.infer<typeof wikiUpdateSchema>): Promise<WikiPage>;
export declare function wikiDelete(params: z.infer<typeof wikiDeleteSchema>): Promise<{
    ok: true;
}>;
export declare function wikiVersions(params: z.infer<typeof wikiVersionsSchema>): Promise<WikiPageVersion[]>;
export declare const wikiTools: ({
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        spaceId: z.ZodString;
        limit: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        spaceId: string;
        limit: number;
    }, {
        spaceId: string;
        limit?: number | undefined;
    }>;
    handler: typeof wikiList;
} | {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        spaceId: z.ZodString;
        pageId: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        spaceId: string;
        pageId: string;
    }, {
        spaceId: string;
        pageId: string;
    }>;
    handler: typeof wikiGet;
} | {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        spaceId: z.ZodString;
        title: z.ZodString;
        body: z.ZodOptional<z.ZodString>;
        tags: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        spaceId: string;
        title: string;
        body?: string | undefined;
        tags?: string[] | undefined;
    }, {
        spaceId: string;
        title: string;
        body?: string | undefined;
        tags?: string[] | undefined;
    }>;
    handler: typeof wikiCreate;
} | {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        spaceId: z.ZodString;
        pageId: z.ZodString;
        title: z.ZodOptional<z.ZodString>;
        body: z.ZodOptional<z.ZodString>;
        tags: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        spaceId: string;
        pageId: string;
        title?: string | undefined;
        body?: string | undefined;
        tags?: string[] | undefined;
    }, {
        spaceId: string;
        pageId: string;
        title?: string | undefined;
        body?: string | undefined;
        tags?: string[] | undefined;
    }>;
    handler: typeof wikiUpdate;
} | {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        spaceId: z.ZodString;
        pageId: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        spaceId: string;
        pageId: string;
    }, {
        spaceId: string;
        pageId: string;
    }>;
    handler: typeof wikiDelete;
} | {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        spaceId: z.ZodString;
        pageId: z.ZodString;
        limit: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        spaceId: string;
        limit: number;
        pageId: string;
    }, {
        spaceId: string;
        pageId: string;
        limit?: number | undefined;
    }>;
    handler: typeof wikiVersions;
})[];
export {};
//# sourceMappingURL=wiki.d.ts.map