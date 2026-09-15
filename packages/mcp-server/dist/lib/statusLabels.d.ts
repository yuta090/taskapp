/**
 * 会議・社内承認・日程調整提案の状態(status)を、呼んだ人に見せてよい日本語のラベルにする。
 * 見覚えのない値（新しい状態が増えた・想定外の値）はそのまま返す（安全側）。
 */
export declare function meetingStatusLabel(status: string): string;
export declare function reviewStatusLabel(status: string): string;
export declare function proposalStatusLabel(status: string): string;
//# sourceMappingURL=statusLabels.d.ts.map