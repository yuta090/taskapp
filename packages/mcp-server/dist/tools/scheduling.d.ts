import { z } from 'zod';
export declare const schedulingListSchema: z.ZodObject<{
    spaceId: z.ZodString;
    status: z.ZodOptional<z.ZodEnum<["open", "confirmed", "cancelled", "expired"]>>;
    limit: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    limit: number;
    status?: "open" | "expired" | "confirmed" | "cancelled" | undefined;
}, {
    spaceId: string;
    status?: "open" | "expired" | "confirmed" | "cancelled" | undefined;
    limit?: number | undefined;
}>;
export declare const schedulingCreateSchema: z.ZodObject<{
    spaceId: z.ZodString;
    title: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    durationMinutes: z.ZodDefault<z.ZodNumber>;
    slots: z.ZodArray<z.ZodObject<{
        startAt: z.ZodString;
        endAt: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        startAt: string;
        endAt: string;
    }, {
        startAt: string;
        endAt: string;
    }>, "many">;
    respondents: z.ZodArray<z.ZodObject<{
        userId: z.ZodString;
        side: z.ZodEnum<["client", "internal"]>;
        isRequired: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        side: "client" | "internal";
        userId: string;
        isRequired: boolean;
    }, {
        side: "client" | "internal";
        userId: string;
        isRequired?: boolean | undefined;
    }>, "many">;
    expiresAt: z.ZodOptional<z.ZodString>;
    videoProvider: z.ZodOptional<z.ZodEnum<["google_meet", "zoom", "teams"]>>;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    title: string;
    durationMinutes: number;
    slots: {
        startAt: string;
        endAt: string;
    }[];
    respondents: {
        side: "client" | "internal";
        userId: string;
        isRequired: boolean;
    }[];
    description?: string | undefined;
    expiresAt?: string | undefined;
    videoProvider?: "google_meet" | "zoom" | "teams" | undefined;
}, {
    spaceId: string;
    title: string;
    slots: {
        startAt: string;
        endAt: string;
    }[];
    respondents: {
        side: "client" | "internal";
        userId: string;
        isRequired?: boolean | undefined;
    }[];
    description?: string | undefined;
    durationMinutes?: number | undefined;
    expiresAt?: string | undefined;
    videoProvider?: "google_meet" | "zoom" | "teams" | undefined;
}>;
export declare const schedulingRespondSchema: z.ZodObject<{
    spaceId: z.ZodString;
    proposalId: z.ZodString;
    responses: z.ZodArray<z.ZodObject<{
        slotId: z.ZodString;
        response: z.ZodEnum<["available", "unavailable_but_proceed", "unavailable"]>;
    }, "strip", z.ZodTypeAny, {
        slotId: string;
        response: "available" | "unavailable_but_proceed" | "unavailable";
    }, {
        slotId: string;
        response: "available" | "unavailable_but_proceed" | "unavailable";
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    proposalId: string;
    responses: {
        slotId: string;
        response: "available" | "unavailable_but_proceed" | "unavailable";
    }[];
}, {
    spaceId: string;
    proposalId: string;
    responses: {
        slotId: string;
        response: "available" | "unavailable_but_proceed" | "unavailable";
    }[];
}>;
export declare const schedulingConfirmSchema: z.ZodObject<{
    spaceId: z.ZodString;
    proposalId: z.ZodString;
    slotId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    proposalId: string;
    slotId: string;
}, {
    spaceId: string;
    proposalId: string;
    slotId: string;
}>;
export declare const schedulingCancelSchema: z.ZodObject<{
    spaceId: z.ZodString;
    proposalId: z.ZodString;
    action: z.ZodEnum<["cancel", "extend"]>;
    newExpiresAt: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    action: "cancel" | "extend";
    proposalId: string;
    newExpiresAt?: string | undefined;
}, {
    spaceId: string;
    action: "cancel" | "extend";
    proposalId: string;
    newExpiresAt?: string | undefined;
}>;
export declare const schedulingResponsesSchema: z.ZodObject<{
    spaceId: z.ZodString;
    proposalId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    proposalId: string;
}, {
    spaceId: string;
    proposalId: string;
}>;
export declare const schedulingSuggestSchema: z.ZodObject<{
    spaceId: z.ZodString;
    userIds: z.ZodArray<z.ZodString, "many">;
    startDate: z.ZodString;
    endDate: z.ZodString;
    durationMinutes: z.ZodDefault<z.ZodNumber>;
    businessHourStart: z.ZodDefault<z.ZodNumber>;
    businessHourEnd: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    durationMinutes: number;
    userIds: string[];
    startDate: string;
    endDate: string;
    businessHourStart: number;
    businessHourEnd: number;
}, {
    spaceId: string;
    userIds: string[];
    startDate: string;
    endDate: string;
    durationMinutes?: number | undefined;
    businessHourStart?: number | undefined;
    businessHourEnd?: number | undefined;
}>;
export declare const schedulingReminderSchema: z.ZodObject<{
    spaceId: z.ZodString;
    proposalId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    proposalId: string;
}, {
    spaceId: string;
    proposalId: string;
}>;
export declare function schedulingList(params: z.infer<typeof schedulingListSchema>): Promise<{
    proposals: {
        respondentCount: number;
        slotCount: number;
        id: string;
        proposal_respondents?: Array<unknown>;
        proposal_slots?: Array<unknown>;
    }[];
}>;
export declare function schedulingCreate(params: z.infer<typeof schedulingCreateSchema>): Promise<{
    proposal: any;
}>;
export declare function schedulingRespond(params: z.infer<typeof schedulingRespondSchema>): Promise<{
    ok: boolean;
    updatedCount: number;
}>;
export declare function schedulingConfirm(params: z.infer<typeof schedulingConfirmSchema>): Promise<{
    ok: boolean;
    meetingId: any;
    slotStart: any;
    slotEnd: any;
}>;
export declare function schedulingCancel(params: z.infer<typeof schedulingCancelSchema>): Promise<{
    ok: boolean;
    action: string;
    proposalId: string;
    newExpiresAt?: undefined;
} | {
    ok: boolean;
    action: string;
    proposalId: string;
    newExpiresAt: string;
}>;
export declare function schedulingGetResponses(params: z.infer<typeof schedulingResponsesSchema>): Promise<{
    proposal: {
        id: any;
        title: any;
        status: any;
        expires_at: any;
        duration_minutes: any;
        created_at: any;
    };
    summary: {
        totalRespondents: number;
        respondedCount: number;
        unrespondedCount: number;
    };
    respondents: {
        respondentId: string;
        userId: string;
        displayName: string;
        side: string;
        isRequired: boolean;
        hasResponded: boolean;
        responseCount: number;
        responses: {
            slot_id: string;
            response: string;
            responded_at: string;
        }[];
    }[];
    slots: {
        slotId: string;
        startAt: string;
        endAt: string;
        slotOrder: number;
        availableCount: number;
        unavailableButProceedCount: number;
        unavailableCount: number;
        totalResponses: number;
    }[];
}>;
interface SuggestedSlot {
    startAt: string;
    endAt: string;
    dayOfWeek: number;
    dateKey: string;
}
export declare function schedulingSuggestSlots(params: z.infer<typeof schedulingSuggestSchema>): Promise<{
    slots: never[];
    connectedUserIds: never[];
    disconnectedUserIds: string[];
    rejectedUserIds: string[];
    message: string;
    slotCount?: undefined;
    failedUserIds?: undefined;
} | {
    slots: SuggestedSlot[];
    slotCount: number;
    connectedUserIds: string[];
    disconnectedUserIds: string[];
    failedUserIds: string[];
    rejectedUserIds: string[];
    message: string | undefined;
}>;
export declare function schedulingSendReminder(params: z.infer<typeof schedulingReminderSchema>): Promise<{
    ok: boolean;
    sentCount: number;
    message: string;
    unrespondedUserIds?: undefined;
} | {
    ok: boolean;
    sentCount: number;
    unrespondedUserIds: string[];
    message?: undefined;
}>;
export declare const schedulingTools: ({
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        spaceId: z.ZodString;
        status: z.ZodOptional<z.ZodEnum<["open", "confirmed", "cancelled", "expired"]>>;
        limit: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        spaceId: string;
        limit: number;
        status?: "open" | "expired" | "confirmed" | "cancelled" | undefined;
    }, {
        spaceId: string;
        status?: "open" | "expired" | "confirmed" | "cancelled" | undefined;
        limit?: number | undefined;
    }>;
    handler: typeof schedulingList;
} | {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        spaceId: z.ZodString;
        title: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        durationMinutes: z.ZodDefault<z.ZodNumber>;
        slots: z.ZodArray<z.ZodObject<{
            startAt: z.ZodString;
            endAt: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            startAt: string;
            endAt: string;
        }, {
            startAt: string;
            endAt: string;
        }>, "many">;
        respondents: z.ZodArray<z.ZodObject<{
            userId: z.ZodString;
            side: z.ZodEnum<["client", "internal"]>;
            isRequired: z.ZodDefault<z.ZodBoolean>;
        }, "strip", z.ZodTypeAny, {
            side: "client" | "internal";
            userId: string;
            isRequired: boolean;
        }, {
            side: "client" | "internal";
            userId: string;
            isRequired?: boolean | undefined;
        }>, "many">;
        expiresAt: z.ZodOptional<z.ZodString>;
        videoProvider: z.ZodOptional<z.ZodEnum<["google_meet", "zoom", "teams"]>>;
    }, "strip", z.ZodTypeAny, {
        spaceId: string;
        title: string;
        durationMinutes: number;
        slots: {
            startAt: string;
            endAt: string;
        }[];
        respondents: {
            side: "client" | "internal";
            userId: string;
            isRequired: boolean;
        }[];
        description?: string | undefined;
        expiresAt?: string | undefined;
        videoProvider?: "google_meet" | "zoom" | "teams" | undefined;
    }, {
        spaceId: string;
        title: string;
        slots: {
            startAt: string;
            endAt: string;
        }[];
        respondents: {
            side: "client" | "internal";
            userId: string;
            isRequired?: boolean | undefined;
        }[];
        description?: string | undefined;
        durationMinutes?: number | undefined;
        expiresAt?: string | undefined;
        videoProvider?: "google_meet" | "zoom" | "teams" | undefined;
    }>;
    handler: typeof schedulingCreate;
} | {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        spaceId: z.ZodString;
        proposalId: z.ZodString;
        responses: z.ZodArray<z.ZodObject<{
            slotId: z.ZodString;
            response: z.ZodEnum<["available", "unavailable_but_proceed", "unavailable"]>;
        }, "strip", z.ZodTypeAny, {
            slotId: string;
            response: "available" | "unavailable_but_proceed" | "unavailable";
        }, {
            slotId: string;
            response: "available" | "unavailable_but_proceed" | "unavailable";
        }>, "many">;
    }, "strip", z.ZodTypeAny, {
        spaceId: string;
        proposalId: string;
        responses: {
            slotId: string;
            response: "available" | "unavailable_but_proceed" | "unavailable";
        }[];
    }, {
        spaceId: string;
        proposalId: string;
        responses: {
            slotId: string;
            response: "available" | "unavailable_but_proceed" | "unavailable";
        }[];
    }>;
    handler: typeof schedulingRespond;
} | {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        spaceId: z.ZodString;
        proposalId: z.ZodString;
        slotId: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        spaceId: string;
        proposalId: string;
        slotId: string;
    }, {
        spaceId: string;
        proposalId: string;
        slotId: string;
    }>;
    handler: typeof schedulingConfirm;
} | {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        spaceId: z.ZodString;
        proposalId: z.ZodString;
        action: z.ZodEnum<["cancel", "extend"]>;
        newExpiresAt: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        spaceId: string;
        action: "cancel" | "extend";
        proposalId: string;
        newExpiresAt?: string | undefined;
    }, {
        spaceId: string;
        action: "cancel" | "extend";
        proposalId: string;
        newExpiresAt?: string | undefined;
    }>;
    handler: typeof schedulingCancel;
} | {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        spaceId: z.ZodString;
        proposalId: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        spaceId: string;
        proposalId: string;
    }, {
        spaceId: string;
        proposalId: string;
    }>;
    handler: typeof schedulingGetResponses;
} | {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        spaceId: z.ZodString;
        userIds: z.ZodArray<z.ZodString, "many">;
        startDate: z.ZodString;
        endDate: z.ZodString;
        durationMinutes: z.ZodDefault<z.ZodNumber>;
        businessHourStart: z.ZodDefault<z.ZodNumber>;
        businessHourEnd: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        spaceId: string;
        durationMinutes: number;
        userIds: string[];
        startDate: string;
        endDate: string;
        businessHourStart: number;
        businessHourEnd: number;
    }, {
        spaceId: string;
        userIds: string[];
        startDate: string;
        endDate: string;
        durationMinutes?: number | undefined;
        businessHourStart?: number | undefined;
        businessHourEnd?: number | undefined;
    }>;
    handler: typeof schedulingSuggestSlots;
} | {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        spaceId: z.ZodString;
        proposalId: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        spaceId: string;
        proposalId: string;
    }, {
        spaceId: string;
        proposalId: string;
    }>;
    handler: typeof schedulingSendReminder;
})[];
export {};
//# sourceMappingURL=scheduling.d.ts.map