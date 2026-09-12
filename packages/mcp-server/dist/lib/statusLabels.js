/**
 * 会議・日程調整提案の状態(status)を、呼んだ人に見せてよい日本語のラベルにする。
 * 見覚えのない値（新しい状態が増えた・想定外の値）はそのまま返す（安全側）。
 */
const MEETING_STATUS_LABELS = {
    planned: '開始前',
    in_progress: '進行中',
    ended: '終了済み',
};
export function meetingStatusLabel(status) {
    return MEETING_STATUS_LABELS[status] ?? status;
}
const PROPOSAL_STATUS_LABELS = {
    open: '回答受付中',
    confirmed: '確定済み',
    cancelled: 'キャンセル済み',
    expired: '期限切れ',
};
export function proposalStatusLabel(status) {
    return PROPOSAL_STATUS_LABELS[status] ?? status;
}
//# sourceMappingURL=statusLabels.js.map