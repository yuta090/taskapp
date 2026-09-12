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
 * rpc_confirm_proposal_slot_as が {ok:false, error: <コード>} で返す断りの理由を、
 * 決まった日本語の ToolUserError に置き換える。認識できないコードは一般的な Error のまま返す。
 */
export declare function mapConfirmProposalError(data: ConfirmProposalErrorData | null | undefined): Error;
export {};
//# sourceMappingURL=rpcErrors.d.ts.map