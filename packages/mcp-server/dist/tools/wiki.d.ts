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
    format: z.ZodOptional<z.ZodEnum<["markdown", "html", "blocks"]>>;
    tags: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    title: string;
    tags?: string[] | undefined;
    body?: string | undefined;
    format?: "markdown" | "html" | "blocks" | undefined;
}, {
    spaceId: string;
    title: string;
    tags?: string[] | undefined;
    body?: string | undefined;
    format?: "markdown" | "html" | "blocks" | undefined;
}>;
export declare const wikiUpdateSchema: z.ZodObject<{
    spaceId: z.ZodString;
    pageId: z.ZodString;
    title: z.ZodOptional<z.ZodString>;
    body: z.ZodOptional<z.ZodString>;
    format: z.ZodOptional<z.ZodEnum<["markdown", "html", "blocks"]>>;
    tags: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    parentPageId: z.ZodEffects<z.ZodOptional<z.ZodNullable<z.ZodString>>, string | null | undefined, unknown>;
    milestoneId: z.ZodEffects<z.ZodOptional<z.ZodNullable<z.ZodString>>, string | null | undefined, unknown>;
    pinned: z.ZodOptional<z.ZodBoolean>;
    expectedUpdatedAt: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    pageId: string;
    title?: string | undefined;
    milestoneId?: string | null | undefined;
    tags?: string[] | undefined;
    body?: string | undefined;
    format?: "markdown" | "html" | "blocks" | undefined;
    parentPageId?: string | null | undefined;
    pinned?: boolean | undefined;
    expectedUpdatedAt?: string | undefined;
}, {
    spaceId: string;
    pageId: string;
    title?: string | undefined;
    milestoneId?: unknown;
    tags?: string[] | undefined;
    body?: string | undefined;
    format?: "markdown" | "html" | "blocks" | undefined;
    parentPageId?: unknown;
    pinned?: boolean | undefined;
    expectedUpdatedAt?: string | undefined;
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
declare const wikiTocSchema: z.ZodObject<{
    spaceId: z.ZodString;
    pageId: z.ZodString;
    action: z.ZodDefault<z.ZodEnum<["add", "remove"]>>;
    expectedUpdatedAt: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    action: "add" | "remove";
    pageId: string;
    expectedUpdatedAt?: string | undefined;
}, {
    spaceId: string;
    pageId: string;
    action?: "add" | "remove" | undefined;
    expectedUpdatedAt?: string | undefined;
}>;
export declare function wikiList(params: z.infer<typeof wikiListSchema>): Promise<WikiPage[]>;
export declare function wikiGet(params: z.infer<typeof wikiGetSchema>): Promise<WikiPage>;
export declare function wikiCreate(params: z.infer<typeof wikiCreateSchema>): Promise<WikiPage>;
/** DB トリガーの拒否理由（親子・マイルストーンの境界/循環）を利用者向けの日本語に置き換える。 */
export declare function describeWikiUpdateError(message: string | undefined): string;
export declare function wikiUpdate(params: z.infer<typeof wikiUpdateSchema>): Promise<WikiPage>;
export declare function wikiDelete(params: z.infer<typeof wikiDeleteSchema>): Promise<{
    ok: true;
}>;
export declare function wikiVersions(params: z.infer<typeof wikiVersionsSchema>): Promise<WikiPageVersion[]>;
export declare function wikiToc(params: z.infer<typeof wikiTocSchema>): Promise<WikiPage>;
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
        format: z.ZodOptional<z.ZodEnum<["markdown", "html", "blocks"]>>;
        tags: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        spaceId: string;
        title: string;
        tags?: string[] | undefined;
        body?: string | undefined;
        format?: "markdown" | "html" | "blocks" | undefined;
    }, {
        spaceId: string;
        title: string;
        tags?: string[] | undefined;
        body?: string | undefined;
        format?: "markdown" | "html" | "blocks" | undefined;
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
        format: z.ZodOptional<z.ZodEnum<["markdown", "html", "blocks"]>>;
        tags: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        parentPageId: z.ZodEffects<z.ZodOptional<z.ZodNullable<z.ZodString>>, string | null | undefined, unknown>;
        milestoneId: z.ZodEffects<z.ZodOptional<z.ZodNullable<z.ZodString>>, string | null | undefined, unknown>;
        pinned: z.ZodOptional<z.ZodBoolean>;
        expectedUpdatedAt: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        spaceId: string;
        pageId: string;
        title?: string | undefined;
        milestoneId?: string | null | undefined;
        tags?: string[] | undefined;
        body?: string | undefined;
        format?: "markdown" | "html" | "blocks" | undefined;
        parentPageId?: string | null | undefined;
        pinned?: boolean | undefined;
        expectedUpdatedAt?: string | undefined;
    }, {
        spaceId: string;
        pageId: string;
        title?: string | undefined;
        milestoneId?: unknown;
        tags?: string[] | undefined;
        body?: string | undefined;
        format?: "markdown" | "html" | "blocks" | undefined;
        parentPageId?: unknown;
        pinned?: boolean | undefined;
        expectedUpdatedAt?: string | undefined;
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
} | {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        spaceId: z.ZodString;
        pageId: z.ZodString;
        action: z.ZodDefault<z.ZodEnum<["add", "remove"]>>;
        expectedUpdatedAt: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        spaceId: string;
        action: "add" | "remove";
        pageId: string;
        expectedUpdatedAt?: string | undefined;
    }, {
        spaceId: string;
        pageId: string;
        action?: "add" | "remove" | undefined;
        expectedUpdatedAt?: string | undefined;
    }>;
    handler: typeof wikiToc;
})[];
export {};
//# sourceMappingURL=wiki.d.ts.map