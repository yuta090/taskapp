import { z } from 'zod';
/**
 * file_* — プロジェクトのファイル（`agentpm file list / upload` の実体）。
 *
 * アップロードは Web(FilesPageClient)と同じ 3 段階:
 *   1. file_upload_url  … files に pending 行を作り、Storage の署名アップロードURLを返す
 *   2. （CLI が署名URLへ実バイトを PUT する。API サーバーはバイトを通さない）
 *   3. file_upload_complete … Storage に実体があることを確認して status='ready' にする
 * サーバーがバイトを中継しないので、関数の応答/要求サイズ上限(4.5MB)に縛られず 50MB まで送れる。
 *
 * - 認可は checkAuth（space 単位）。client/vendor 権限のキーは Web と同じく origin='client' を強制。
 * - uploaded_by は API キーに紐づく利用者。紐づいていないキー(user_id NULL)では作れない。
 */
/** Web 側(src/app/api/files/upload-url/route.ts)と同じ上限 */
export declare const MAX_FILE_SIZE_BYTES = 52428800;
declare const fileListSchema: z.ZodObject<{
    spaceId: z.ZodString;
    limit: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    limit: number;
}, {
    spaceId: string;
    limit?: number | undefined;
}>;
declare const fileUploadUrlSchema: z.ZodObject<{
    spaceId: z.ZodString;
    name: z.ZodString;
    mimeType: z.ZodOptional<z.ZodString>;
    sizeBytes: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    name: string;
    sizeBytes: number;
    mimeType?: string | undefined;
}, {
    spaceId: string;
    name: string;
    sizeBytes: number;
    mimeType?: string | undefined;
}>;
declare const fileUploadCompleteSchema: z.ZodObject<{
    spaceId: z.ZodString;
    fileId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    fileId: string;
}, {
    spaceId: string;
    fileId: string;
}>;
export interface FileListItem {
    id: string;
    name: string;
    /** 何のファイルか（一覧の行に出る短い説明）。未記入は null */
    description: string | null;
    mimeType: string;
    sizeBytes: number;
    origin: 'internal' | 'client';
    clientVisible: boolean;
    createdAt: string;
    downloadPath: string;
}
export interface FileUploadUrlResult {
    fileId: string;
    signedUrl: string;
    token: string;
    path: string;
    maxBytes: number;
}
export interface FileUploadCompleteResult {
    ok: boolean;
    fileId: string;
    name: string;
    downloadPath: string;
    /** CSV/TSV のときだけ: TaskApp 内の表ビューのパス */
    tablePath: string | null;
    message: string;
}
export declare function toStorageKeyName(name: string): string;
export declare function fileList(params: z.infer<typeof fileListSchema>): Promise<FileListItem[]>;
export declare function fileUploadUrl(params: z.infer<typeof fileUploadUrlSchema>): Promise<FileUploadUrlResult>;
export declare function fileUploadComplete(params: z.infer<typeof fileUploadCompleteSchema>): Promise<FileUploadCompleteResult>;
declare const fileUpdateSchema: z.ZodObject<{
    spaceId: z.ZodString;
    fileId: z.ZodString;
    description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    name: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    fileId: string;
    description?: string | null | undefined;
    name?: string | undefined;
}, {
    spaceId: string;
    fileId: string;
    description?: string | null | undefined;
    name?: string | undefined;
}>;
export declare function fileUpdate(params: z.infer<typeof fileUpdateSchema>): Promise<FileListItem>;
export declare const fileTools: ({
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
    handler: typeof fileList;
} | {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        spaceId: z.ZodString;
        name: z.ZodString;
        mimeType: z.ZodOptional<z.ZodString>;
        sizeBytes: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        spaceId: string;
        name: string;
        sizeBytes: number;
        mimeType?: string | undefined;
    }, {
        spaceId: string;
        name: string;
        sizeBytes: number;
        mimeType?: string | undefined;
    }>;
    handler: typeof fileUploadUrl;
} | {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        spaceId: z.ZodString;
        fileId: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        spaceId: string;
        fileId: string;
    }, {
        spaceId: string;
        fileId: string;
    }>;
    handler: typeof fileUploadComplete;
} | {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        spaceId: z.ZodString;
        fileId: z.ZodString;
        description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        name: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        spaceId: string;
        fileId: string;
        description?: string | null | undefined;
        name?: string | undefined;
    }, {
        spaceId: string;
        fileId: string;
        description?: string | null | undefined;
        name?: string | undefined;
    }>;
    handler: typeof fileUpdate;
})[];
export {};
//# sourceMappingURL=files.d.ts.map