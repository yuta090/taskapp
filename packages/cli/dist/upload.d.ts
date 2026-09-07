/** サーバー側(files.ts / upload-url route)と同じ上限 */
export declare const MAX_UPLOAD_BYTES = 52428800;
export declare function guessMimeType(fileName: string): string;
export interface UploadDeps {
    callTool: (tool: string, params: Record<string, unknown>) => Promise<unknown>;
    fetch: (url: string, init: RequestInit) => Promise<Response>;
    /** sizeBytes を返さないときは bytes.length を使う（テストで巨大バッファを作らないための逃げ道） */
    readFile: (path: string) => Promise<{
        bytes: Buffer;
        baseName: string;
        sizeBytes?: number;
    }>;
}
export interface UploadOptions {
    filePath: string;
    spaceId: string;
    /** 省略時はファイル名そのまま */
    name?: string;
    /** 省略時は拡張子から推定 */
    mimeType?: string;
    /** 署名URLを返すツール名（manifest の tool） */
    tool: string;
    /** 完了を確定するツール名（manifest の completeTool） */
    completeTool: string;
}
export declare const defaultUploadDeps: Omit<UploadDeps, 'callTool'>;
export declare function uploadFile(opts: UploadOptions, deps: UploadDeps): Promise<unknown>;
