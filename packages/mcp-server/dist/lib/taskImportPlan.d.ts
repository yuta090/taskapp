/**
 * `task_import`（CSV 一括取り込み）の純粋ロジック。
 *
 * DB を一切触らない層に「CSV → 正規化行 → 作成計画」を閉じ込め、ハンドラ(tools/taskImport.ts)は
 * 「DBから引いた既存タスク/メンバー/マイルストーンを Map で渡す → 計画どおりに insert する」
 * だけにする。CSV の解釈ルール（見出しの別名・日本語の値・親子の解決・重複の扱い）はすべて
 * ここにあり、taskImportPlan.test.ts が仕様書を兼ねる。
 *
 * 取り込みの契約:
 *   - 1行でもエラーがあれば全体を作らない（半端に取り込まれる方が後始末が高くつく）
 *   - スペースに同じタイトルのタスクが既にあれば作らずスキップ（再実行しても二重に増えない）
 *   - parent 列は「タイトル」で親を指す。CSV内の行 → スペースの既存タスク → 無ければ自動作成
 */
export type ImportStatus = 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done' | 'considering';
export type Side = 'client' | 'internal';
export type Scope = 'deliverable' | 'internal';
export declare const MAX_IMPORT_ROWS = 500;
/** DB トリガー(20260310_000_multi_level_hierarchy.sql)の max_depth と同じ値 */
export declare const MAX_DEPTH = 10;
export interface ImportRow {
    line: number;
    title: string;
    description: string;
    status: ImportStatus | null;
    ball: Side | null;
    origin: Side | null;
    clientScope: Scope | null;
    startDate: string | null;
    dueDate: string | null;
    /** 担当者の参照（メール or 表示名）。解決は planTaskImport で行う */
    assignee: string | null;
    clientOwners: string[];
    internalOwners: string[];
    parent: string | null;
    priority: number | null;
    milestone: string | null;
}
export interface ImportIssue {
    line: number;
    title?: string;
    message: string;
}
export interface ParsedImport {
    rows: ImportRow[];
    ignoredColumns: string[];
    errors: ImportIssue[];
}
/** 'YYYY-MM-DD' / 'YYYY/M/D' を 'YYYY-MM-DD' に正規化。妥当な暦日でなければ null。 */
export declare function normalizeDate(raw: string): string | null;
export declare function splitPeople(raw: string): string[];
/** CSV テキストを正規化した行に変換する。値の不正は行番号つきで errors に積む。 */
export declare function parseTaskImportCsv(text: string): ParsedImport;
export interface UserDirectory {
    /** 小文字化したメール → user_id */
    byEmail: Map<string, string>;
    /** 表示名 → user_id[]（同名が複数いれば曖昧としてエラーにする） */
    byName: Map<string, string[]>;
}
export interface PlanInput {
    rows: ImportRow[];
    /** スペース内の既存タスク: タイトル → id */
    existingTasks: Map<string, string>;
    users: UserDirectory;
    /** スペース内のマイルストーン: 名前 → id */
    milestones: Map<string, string>;
    /** タスクIDの採番（テストで決定的にするため注入） */
    newId: () => string;
}
export interface PlannedTask {
    id: string;
    /** 元CSVの行番号。自動作成した親は null */
    line: number | null;
    title: string;
    description: string;
    status: ImportStatus;
    ball: Side;
    origin: Side;
    clientScope: Scope;
    startDate: string | null;
    dueDate: string | null;
    assigneeId: string | null;
    parentId: string | null;
    priority: number | null;
    milestoneId: string | null;
    clientOwnerIds: string[];
    internalOwnerIds: string[];
    /** 親からの深さ（CSV/自動親の範囲内で数える。0=最上位） */
    depth: number;
    autoParent: boolean;
}
export interface ImportPlan {
    /** depth 昇順（親が必ず先）に並んだ作成対象 */
    tasks: PlannedTask[];
    autoParents: string[];
    skipped: {
        line: number;
        title: string;
        reason: string;
    }[];
    errors: ImportIssue[];
}
export declare function planTaskImport(input: PlanInput): ImportPlan;
//# sourceMappingURL=taskImportPlan.d.ts.map