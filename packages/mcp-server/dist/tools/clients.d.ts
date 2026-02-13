import { z } from 'zod';
export interface ClientInvite {
    id: string;
    org_id: string;
    space_id: string;
    email: string;
    role: 'client' | 'member';
    token: string;
    expires_at: string;
    accepted_at: string | null;
    created_by: string;
    created_at: string;
}
export interface OrgMembership {
    id: string;
    org_id: string;
    user_id: string;
    role: 'owner' | 'member' | 'client';
    created_at: string;
}
export interface SpaceMembership {
    id: string;
    space_id: string;
    user_id: string;
    role: 'admin' | 'editor' | 'viewer' | 'client';
    created_at: string;
}
export declare const clientInviteCreateSchema: z.ZodObject<{
    email: z.ZodString;
    spaceId: z.ZodString;
    expiresInDays: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    email: string;
    expiresInDays: number;
}, {
    spaceId: string;
    email: string;
    expiresInDays?: number | undefined;
}>;
export declare const clientInviteBulkCreateSchema: z.ZodObject<{
    emails: z.ZodArray<z.ZodString, "many">;
    spaceId: z.ZodString;
    expiresInDays: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    expiresInDays: number;
    emails: string[];
}, {
    spaceId: string;
    emails: string[];
    expiresInDays?: number | undefined;
}>;
export declare const clientListSchema: z.ZodObject<{
    spaceId: z.ZodOptional<z.ZodString>;
    includeInvites: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    includeInvites: boolean;
    spaceId?: string | undefined;
}, {
    spaceId?: string | undefined;
    includeInvites?: boolean | undefined;
}>;
export declare const clientGetSchema: z.ZodObject<{
    userId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    userId: string;
}, {
    userId: string;
}>;
export declare const clientUpdateSchema: z.ZodObject<{
    userId: z.ZodString;
    spaceId: z.ZodString;
    role: z.ZodEnum<["client", "viewer"]>;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    role: "client" | "viewer";
    userId: string;
}, {
    spaceId: string;
    role: "client" | "viewer";
    userId: string;
}>;
export declare const clientAddToSpaceSchema: z.ZodObject<{
    userId: z.ZodString;
    spaceId: z.ZodString;
    role: z.ZodDefault<z.ZodEnum<["client", "viewer"]>>;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    role: "client" | "viewer";
    userId: string;
}, {
    spaceId: string;
    userId: string;
    role?: "client" | "viewer" | undefined;
}>;
export declare const clientInviteListSchema: z.ZodObject<{
    spaceId: z.ZodOptional<z.ZodString>;
    status: z.ZodDefault<z.ZodEnum<["pending", "accepted", "expired", "all"]>>;
}, "strip", z.ZodTypeAny, {
    status: "pending" | "accepted" | "expired" | "all";
    spaceId?: string | undefined;
}, {
    spaceId?: string | undefined;
    status?: "pending" | "accepted" | "expired" | "all" | undefined;
}>;
export declare const clientInviteResendSchema: z.ZodObject<{
    inviteId: z.ZodString;
    expiresInDays: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    expiresInDays: number;
    inviteId: string;
}, {
    inviteId: string;
    expiresInDays?: number | undefined;
}>;
export declare function clientInviteCreate(params: z.infer<typeof clientInviteCreateSchema>): Promise<ClientInvite>;
export declare function clientInviteBulkCreate(params: z.infer<typeof clientInviteBulkCreateSchema>): Promise<{
    created: number;
    failed: string[];
    invites: ClientInvite[];
}>;
export declare function clientList(params: z.infer<typeof clientListSchema>): Promise<{
    members: OrgMembership[];
    pendingInvites: ClientInvite[];
}>;
export declare function clientGet(params: z.infer<typeof clientGetSchema>): Promise<{
    membership: OrgMembership;
    spaces: SpaceMembership[];
}>;
export declare function clientUpdate(params: z.infer<typeof clientUpdateSchema>): Promise<SpaceMembership>;
export declare function clientAddToSpace(params: z.infer<typeof clientAddToSpaceSchema>): Promise<SpaceMembership>;
export declare function clientInviteList(params: z.infer<typeof clientInviteListSchema>): Promise<ClientInvite[]>;
export declare function clientInviteResend(params: z.infer<typeof clientInviteResendSchema>): Promise<ClientInvite>;
export declare const clientTools: ({
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        email: z.ZodString;
        spaceId: z.ZodString;
        expiresInDays: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        spaceId: string;
        email: string;
        expiresInDays: number;
    }, {
        spaceId: string;
        email: string;
        expiresInDays?: number | undefined;
    }>;
    handler: typeof clientInviteCreate;
} | {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        emails: z.ZodArray<z.ZodString, "many">;
        spaceId: z.ZodString;
        expiresInDays: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        spaceId: string;
        expiresInDays: number;
        emails: string[];
    }, {
        spaceId: string;
        emails: string[];
        expiresInDays?: number | undefined;
    }>;
    handler: typeof clientInviteBulkCreate;
} | {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        spaceId: z.ZodOptional<z.ZodString>;
        includeInvites: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        includeInvites: boolean;
        spaceId?: string | undefined;
    }, {
        spaceId?: string | undefined;
        includeInvites?: boolean | undefined;
    }>;
    handler: typeof clientList;
} | {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        userId: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        userId: string;
    }, {
        userId: string;
    }>;
    handler: typeof clientGet;
} | {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        userId: z.ZodString;
        spaceId: z.ZodString;
        role: z.ZodEnum<["client", "viewer"]>;
    }, "strip", z.ZodTypeAny, {
        spaceId: string;
        role: "client" | "viewer";
        userId: string;
    }, {
        spaceId: string;
        role: "client" | "viewer";
        userId: string;
    }>;
    handler: typeof clientUpdate;
} | {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        userId: z.ZodString;
        spaceId: z.ZodString;
        role: z.ZodDefault<z.ZodEnum<["client", "viewer"]>>;
    }, "strip", z.ZodTypeAny, {
        spaceId: string;
        role: "client" | "viewer";
        userId: string;
    }, {
        spaceId: string;
        userId: string;
        role?: "client" | "viewer" | undefined;
    }>;
    handler: typeof clientAddToSpace;
} | {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        spaceId: z.ZodOptional<z.ZodString>;
        status: z.ZodDefault<z.ZodEnum<["pending", "accepted", "expired", "all"]>>;
    }, "strip", z.ZodTypeAny, {
        status: "pending" | "accepted" | "expired" | "all";
        spaceId?: string | undefined;
    }, {
        spaceId?: string | undefined;
        status?: "pending" | "accepted" | "expired" | "all" | undefined;
    }>;
    handler: typeof clientInviteList;
} | {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        inviteId: z.ZodString;
        expiresInDays: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        expiresInDays: number;
        inviteId: string;
    }, {
        inviteId: string;
        expiresInDays?: number | undefined;
    }>;
    handler: typeof clientInviteResend;
})[];
//# sourceMappingURL=clients.d.ts.map