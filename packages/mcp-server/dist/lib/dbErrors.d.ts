interface DbError {
    code?: string;
    message?: string;
}
/**
 * `.single()` が0件（PGRST116）で断ったときだけ、見つからない旨のToolUserError(404)にする。
 * それ以外の理由は、中身をサーバーの記録にだけ残し、一般のエラーのまま返す。
 *
 * どちらも元の DB エラーを cause として持たせる。呼んだ人（CLI/AI）には返らないが、
 * /api/tools・/api/mcp の利用記録（運営画面 /admin/cli-usage 専用）で原因を追えるようにする。
 */
export declare function notFoundOr(error: DbError, context: string, notFoundMessage: string, fallbackMessage: string): Error;
/** DBの理由の中身をサーバーの記録にだけ残し、一般のエラーのまま返す。 */
export declare function hideDbError(error: DbError, context: string, fallbackMessage: string): Error;
export {};
//# sourceMappingURL=dbErrors.d.ts.map