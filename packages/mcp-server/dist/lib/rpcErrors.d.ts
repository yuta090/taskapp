/**
 * ball_pass / meeting_start / meeting_end / review_open / review_approve / review_block の
 * RPC が RAISE EXCEPTION で返すメッセージを、決まった日本語の ToolUserError に置き換える。
 * 認識できないメッセージは fallbackMessage を持つ一般的な Error のまま返す。
 */
export declare function mapRaiseExceptionError(message: string, fallbackMessage: string): Error;
interface ConfirmProposalErrorData {
    error?: string;
    current_status?: string;
}
/**
 * mcp_dry_run_delete / mcp_confirm_delete が成功したレスポンスの中で返す
 * 断りの理由（data.error）を、決まった日本語にする。これらは呼び出し元の RPC 自身が
 * 決めた文言でありDBの生の例外ではないため、認識できない理由もそのまま返す。
 */
export declare function translateDryRunBusinessError(error: string | null | undefined): string | undefined;
export declare function mapConfirmProposalError(data: ConfirmProposalErrorData | null | undefined): Error;
export {};
//# sourceMappingURL=rpcErrors.d.ts.map