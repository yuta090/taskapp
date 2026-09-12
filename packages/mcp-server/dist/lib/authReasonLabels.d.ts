/**
 * 権限の確認で断られた理由を、利用者に見せる決まった日本語にする。
 * #843 の状態ラベル（statusLabels.ts）と同じ形（言い換えを1か所に集約する）。
 */
export declare const AUTH_REASON_LABELS: {
    readonly invalidOrExpiredApiKey: "APIキーが無効か期限切れです";
    readonly spaceIdRequired: "spaceId の指定が必要です";
    readonly spaceNotAllowed: "このAPIキーで許可されたプロジェクトではありません";
    readonly keyNotBoundToSpace: "このAPIキーはどのプロジェクトにも紐づいていません";
    readonly keyOwnerNotSet: "このAPIキーに持ち主が設定されていません";
};
/** 例: 「Action "write" not allowed for this API key」に対応する断り文言 */
export declare function actionNotAllowedReason(action: string): string;
/** 例: 「Tool "space_list" requires scope=org or scope=user (current: space)」に対応する断り文言 */
export declare function scopeRequiredReason(toolName: string, requiredScope: string, currentScope: string): string;
//# sourceMappingURL=authReasonLabels.d.ts.map