interface DbError {
    code?: string;
    message?: string;
}
/**
 * `.single()` が0件（PGRST116）で断ったときだけ、見つからない旨のToolUserError(404)にする。
 * それ以外の理由は、中身をサーバーの記録にだけ残し、一般のエラーのまま返す。
 */
export declare function notFoundOr(error: DbError, context: string, notFoundMessage: string, fallbackMessage: string): Error;
/** DBの理由の中身をサーバーの記録にだけ残し、一般のエラーのまま返す。 */
export declare function hideDbError(error: DbError, context: string, fallbackMessage: string): Error;
export {};
//# sourceMappingURL=dbErrors.d.ts.map