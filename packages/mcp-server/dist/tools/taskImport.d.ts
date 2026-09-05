import { z } from 'zod';
import { type ImportIssue } from '../lib/taskImportPlan.js';
/**
 * task_import — CSV からタスクを一括作成する（`agentpm task import` の実体）。
 *
 * 設計:
 *   - 既定は dryRun=true。作成計画（何件作る・何件スキップ・どこがエラーか）だけ返し、DBは触らない。
 *     `--no-dry-run` で初めて書く。task_delete と同じ「まず見せる」流儀。
 *   - 全か無か: 1行でもエラーがあれば実行モードでも1件も作らない。半端に入った状態の後始末が
 *     一番高くつくため。
 *   - 再実行に強い: 同じタイトルのタスクがスペースに既にあれば作らずスキップする。
 *   - 親→子の順に深さごとに insert する。tasks の親子検証トリガー(BEFORE ROW)は同一 INSERT 文の
 *     先行行を見られないため、深さ別に文を分ける。id はここで採番して parent_task_id を先に確定させる。
 *   - 認可は 'bulk'（client_invite_bulk_create と同じ区分。editor 権限のキーでは通らない）。
 *
 * CSV の解釈ルールはすべて ../lib/taskImportPlan.ts にある（ここは DB との橋渡しのみ）。
 */
export declare const taskImportSchema: z.ZodObject<{
    spaceId: z.ZodString;
    csv: z.ZodString;
    dryRun: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    spaceId: string;
    dryRun: boolean;
    csv: string;
}, {
    spaceId: string;
    csv: string;
    dryRun?: boolean | undefined;
}>;
export interface TaskImportPreviewRow {
    line: number | null;
    title: string;
    status: string;
    ball: string;
    clientScope: string;
    dueDate: string | null;
    parent: string | null;
    autoParent: boolean;
}
export interface TaskImportResult {
    success: boolean;
    dryRun: boolean;
    summary: {
        rows: number;
        toCreate: number;
        autoParents: number;
        skipped: number;
        errors: number;
    };
    errors: ImportIssue[];
    skipped: {
        line: number;
        title: string;
        reason: string;
    }[];
    ignoredColumns: string[];
    preview: TaskImportPreviewRow[];
    created: {
        id: string;
        title: string;
        parentId: string | null;
    }[];
    message: string;
}
export declare function taskImport(params: z.infer<typeof taskImportSchema>): Promise<TaskImportResult>;
export declare const taskImportTools: {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        spaceId: z.ZodString;
        csv: z.ZodString;
        dryRun: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        spaceId: string;
        dryRun: boolean;
        csv: string;
    }, {
        spaceId: string;
        csv: string;
        dryRun?: boolean | undefined;
    }>;
    handler: typeof taskImport;
}[];
//# sourceMappingURL=taskImport.d.ts.map