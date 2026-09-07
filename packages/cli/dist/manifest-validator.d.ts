export interface ManifestOption {
    flags: string;
    description?: string;
    param: string;
    required?: boolean;
    default?: string;
    type?: 'int' | 'float' | 'bool' | 'json' | 'string[]' | 'negatable';
    choices?: string[];
    resolve?: 'spaceId';
    dependsOn?: string;
    conflictsWith?: string;
}
export interface ManifestSubcommand {
    name: string;
    description: string;
    aliases?: string[];
    tool: string;
    examples?: string[];
    deprecated?: boolean;
    hidden?: boolean;
    stdinMode?: boolean;
    /**
     * stdin の読み方。'json'(既定)はオブジェクトとして解釈し params にマージ、
     * 'text' は生テキストのまま stdinParam で指定した1パラメータに入れる（CSV取り込み等）。
     */
    stdinFormat?: 'json' | 'text';
    /** stdinFormat='text' のとき、テキストを入れるパラメータ名 */
    stdinParam?: string;
    /**
     * ファイルアップロード（3段階）。true のとき CLI は `--file` のローカルファイルを読み、
     * tool（署名URL発行）→ 署名URLへ PUT → completeTool（完了確定）の順に処理する。
     * 旧 CLI(0.3.x 以前)はこのフィールドを知らず tool を直接呼ぶ（このコマンドだけ失敗する）。
     */
    uploadMode?: boolean;
    /** uploadMode=true のとき、完了を確定するツール名 */
    completeTool?: string;
    options: ManifestOption[];
}
export interface ManifestCommand {
    name: string;
    description: string;
    aliases?: string[];
    tool?: string;
    options?: ManifestOption[];
    subcommands?: ManifestSubcommand[];
}
export interface Manifest {
    version: string;
    minCliVersion: string;
    generatedAt: string;
    checksum: string;
    commands: ManifestCommand[];
}
/** Strip ANSI escape sequences and control characters */
export declare function sanitize(str: string): string;
/**
 * Validate a parsed manifest object.
 * Returns the typed manifest or throws ManifestValidationError.
 */
export declare function validateManifest(raw: unknown): Manifest;
/**
 * Compare semver strings: returns true if current >= required
 */
export declare function satisfiesVersion(current: string, required: string): boolean;
