/**
 * CLI / API からの全文差し替えで、他の人の変更を黙って消さないための合言葉。
 *
 * 画面には「開いたときの `updated_at` のままの行だけ書く」歯止め（楽観ロック）が入っている。
 * CLI にはそれが無く、`minutes_update` / `wiki_update` は**版を見ずに上書き**していた。
 * AI秘書や別の人が先に書いていても、成功として返る。議事録には控えが無いので復旧できない。
 *
 * 足すのは任意の `expectedUpdatedAt` だけ。**省略時はこれまでどおり無条件で上書き**する
 * （既存の呼び出しを壊さないため）。渡したときだけ、その版のままの行だけを書く。
 */
/** 画面（MinutesConflictError / WikiConflictError）と同じ趣旨の文言 */
export declare const STALE_WRITE_MESSAGE = "\u3053\u306E\u5185\u5BB9\u306F\u3001\u5225\u306E\u5834\u6240\u3067\u66F4\u65B0\u3055\u308C\u3066\u3044\u307E\u3059\u3002\u6700\u65B0\u3092\u8AAD\u307F\u8FBC\u3093\u3067\u304B\u3089\u3082\u3046\u4E00\u5EA6\u304A\u8A66\u3057\u304F\u3060\u3055\u3044";
export declare class StaleWriteError extends Error {
    constructor(message?: string);
}
/**
 * 更新の結果が0行だったときに、競合として断るか判断する。
 *
 * `expectedUpdatedAt` を渡していないのに0行なら、それは競合ではなく
 * 「対象が見つからない」（消された等）。区別して別の言葉で返す。
 */
export declare function assertWriteApplied(rowCount: number, expectedUpdatedAt: string | undefined, notFoundMessage: string): void;
//# sourceMappingURL=staleWrite.d.ts.map