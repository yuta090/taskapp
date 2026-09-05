/**
 * stdin / --file からの入力をツール呼び出しの params に組み立てる純粋関数。
 *
 * dynamic-loader.ts から切り出しているのは、Commander や process.stdin に触らない形にして
 * テストできるようにするため（ルートの vitest から ../../packages/cli/src/input.ts を直接読む）。
 * 依存ゼロを保つこと（ルートの `tsc --noEmit` がこのファイルも辿るため、commander 等を import
 * すると解決できずに落ちる）。
 */
import type { ManifestOption, ManifestSubcommand } from './manifest-validator.js';
/** "-s, --space-id <uuid>" → "space-id" */
export declare function extractLongFlag(flags: string): string;
/** "space-id" → "spaceId"（Commander の opts キー） */
export declare function camelCase(str: string): string;
/**
 * manifest のオプション定義 → Commander が opts に格納するキー。
 * 否定形(--no-dry-run)は Commander が "no-" を外した正の名前(dryRun)に格納するので、
 * そのまま camelCase すると "noDryRun" になって値を拾えない（実際に踏んだバグ）。
 */
export declare function optionKey(def: Pick<ManifestOption, 'flags' | 'type'>): string;
/** UTF-8 BOM を落とす（Excel/スプレッドシートの CSV 書き出しは BOM 付きが多い） */
export declare function stripBom(text: string): string;
/**
 * CLI オプションを params に足す（stdin 側に同じキーがあれば stdin を優先。spaceId だけは
 * CLI 側を優先＝呼び出し元で resolve 済みの値を渡す）。JSON/text 両モードで共通。
 */
export declare function mergeCliOptions(options: ManifestOption[], opts: Record<string, unknown>, params: Record<string, unknown>, resolvedSpaceId: string | undefined): Record<string, unknown>;
/**
 * stdin（または --file）で受けた生テキストから params を作る。
 *  - stdinFormat='text': そのまま sub.stdinParam に入れる
 *  - それ以外(json): JSON.parse したオブジェクトを土台にする
 */
export declare function buildStdinParams(sub: Pick<ManifestSubcommand, 'stdinFormat' | 'stdinParam' | 'options' | 'name'>, rawText: string, opts: Record<string, unknown>, resolvedSpaceId: string | undefined): Record<string, unknown>;
