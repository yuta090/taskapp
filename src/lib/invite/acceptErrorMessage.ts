/**
 * 招待受諾API（/api/invites/[token]/accept）のエラー応答を画面に出す文言にする。
 *
 * apiMfaGuard.ts の 403 は { error: 'mfa_required', message: '二要素認証のコード入力が
 * 必要です' } という形で返る。error（合言葉）をそのまま出すと英語の内部符号
 * "mfa_required" が画面に出てしまうため、サーバーが用意した具体的な message が
 * あればそれを優先する。無ければ error（すでに日本語の場合が多い）へ、それも
 * 無ければ fallback へ倒す。
 */
export function describeAcceptInviteError(
  data: { error?: string; message?: string } | null | undefined,
  fallback: string
): string {
  return data?.message || data?.error || fallback
}

/** 二要素認証のコード入力が必要で断られたか（コード入力画面への案内を出す判断に使う） */
export function isMfaRequiredError(data: { error?: string } | null | undefined): boolean {
  return data?.error === 'mfa_required'
}
