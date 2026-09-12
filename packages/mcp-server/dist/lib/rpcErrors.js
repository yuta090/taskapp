/**
 * DB の断りの理由（RAISE EXCEPTION の文言・rpc_confirm_proposal_slot_as が返す
 * jsonb の error コード）を、呼んだ人に見せてよい決まった日本語（ToolUserError）に
 * 置き換える。認識できない理由は、これまでどおり中身を隠した一般的なエラーのまま
 * 返す（2026-07 のエラー詳細漏洩対策を崩さない）。
 */
import { ToolUserError } from '../errors.js';
const RAISE_PATTERNS = [
    { test: /^Meeting not found:/, status: 404, toMessage: () => '会議が見つかりません' },
    { test: /^Not authorized to end this meeting$/, status: 403, toMessage: () => 'この会議を終了する権限がありません' },
    { test: /^Not authorized to access this meeting$/, status: 403, toMessage: () => 'この会議を開始する権限がありません' },
    {
        test: /^Meeting can only end from in_progress status, current: (.+)$/,
        status: 409,
        toMessage: (m) => `会議は進行中のときだけ終了できます（現在: ${m[1]}）`,
    },
    {
        test: /^Meeting can only start from planned status, current: (.+)$/,
        status: 409,
        toMessage: (m) => `会議は開始前のときだけ開始できます（現在: ${m[1]}）`,
    },
    { test: /^Task not found:/, status: 404, toMessage: () => 'タスクが見つかりません' },
    { test: /^Not authorized to access this task$/, status: 403, toMessage: () => 'このタスクにアクセスする権限がありません' },
    { test: /^Client owner required when ball=client$/, status: 400, toMessage: () => 'ball=clientの場合はclientOwnerIdsが必須です' },
    { test: /^No review found for task:/, status: 404, toMessage: () => 'このタスクにはレビューがありません' },
    { test: /^Not authorized to access this review$/, status: 403, toMessage: () => 'このレビューにアクセスする権限がありません' },
    { test: /^User is not a reviewer for this task$/, status: 403, toMessage: () => 'このタスクのレビュアーに指定されていません' },
    { test: /^At least one reviewer required$/, status: 400, toMessage: () => 'レビュアーを1人以上指定してください' },
    {
        test: /^Insufficient permissions: you must be an admin or editor in this space$/,
        status: 403,
        toMessage: () => 'このプロジェクトの管理者または編集者だけがレビューを依頼できます',
    },
    {
        test: /^One or more reviewer IDs are not internal members \(admin\/editor\) of this space$/,
        status: 400,
        toMessage: () => 'レビュアーに指定できるのは、このプロジェクトの社内メンバー（管理者・編集者）だけです',
    },
];
/**
 * ball_pass / meeting_start / meeting_end / review_open / review_approve / review_block の
 * RPC が RAISE EXCEPTION で返すメッセージを、決まった日本語の ToolUserError に置き換える。
 * 認識できないメッセージは fallbackMessage を持つ一般的な Error のまま返す。
 */
export function mapRaiseExceptionError(message, fallbackMessage) {
    for (const pattern of RAISE_PATTERNS) {
        const match = message.match(pattern.test);
        if (match)
            return new ToolUserError(pattern.toMessage(match), pattern.status);
    }
    return new Error(fallbackMessage);
}
/**
 * rpc_confirm_proposal_slot_as が {ok:false, error: <コード>} で返す断りの理由を、
 * 決まった日本語の ToolUserError に置き換える。認識できないコードは一般的な Error のまま返す。
 */
export function mapConfirmProposalError(data) {
    switch (data?.error) {
        case 'proposal_not_found':
            return new ToolUserError('提案が見つかりません', 404);
        case 'not_authorized':
            return new ToolUserError('この提案を確定する権限がありません', 403);
        case 'proposal_not_open':
            return new ToolUserError(`この提案は現在「${data.current_status ?? ''}」のため確定できません`, 409);
        case 'slot_not_found':
            return new ToolUserError('指定されたスロットが見つかりません', 404);
        case 'no_required_respondents':
            return new ToolUserError('必須の回答者が設定されていません', 409);
        case 'not_all_agreed':
            return new ToolUserError('必須回答者の全員が参加可能・欠席OKのいずれかで回答していません', 409);
        default:
            return new Error('確定に失敗しました');
    }
}
//# sourceMappingURL=rpcErrors.js.map