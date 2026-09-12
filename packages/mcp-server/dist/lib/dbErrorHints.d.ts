interface DbError {
    code?: string;
    message?: string;
}
export declare function dbErrorHint(error: DbError): string | null;
/**
 * DBが断った理由の中身をサーバーの記録にだけ残し、次にできることが分かる
 * ヒント（重複・必須項目の不足・つながりの不整合）があればそれを ToolUserError で、
 * 無ければ中身を隠した一般の Error（fallbackMessage）を返す。
 */
export declare function hideDbErrorWithHint(error: DbError, context: string, fallbackMessage: string): Error;
export {};
//# sourceMappingURL=dbErrorHints.d.ts.map