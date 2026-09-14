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
export const STALE_WRITE_MESSAGE = 'この内容は、別の場所で更新されています。最新を読み込んでからもう一度お試しください';
export class StaleWriteError extends Error {
    constructor(message = STALE_WRITE_MESSAGE) {
        super(message);
        this.name = 'StaleWriteError';
    }
}
/**
 * 更新の結果が0行だったときに、競合として断るか判断する。
 *
 * `expectedUpdatedAt` を渡していないのに0行なら、それは競合ではなく
 * 「対象が見つからない」（消された等）。区別して別の言葉で返す。
 */
export function assertWriteApplied(rowCount, expectedUpdatedAt, notFoundMessage) {
    if (rowCount > 0)
        return;
    if (expectedUpdatedAt !== undefined)
        throw new StaleWriteError();
    throw new Error(notFoundMessage);
}
//# sourceMappingURL=staleWrite.js.map