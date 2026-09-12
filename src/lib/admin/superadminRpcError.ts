/**
 * rpc_is_superadmin() が db_pre_request（20260907144900_mfa_pre_request.sql）に、
 * 二要素認証のコード入力待ち(aal1)として断られたか。
 *
 * 42501 は「関数の実行権が無い」等、二要素の途中とは別の理由でも返ってくる符号
 * （PostgreSQL の insufficient_privilege 全般）。db_pre_request がコード入力待ちを
 * 断るときは message も固定で 'mfa_required' になるので、その組み合わせまで
 * 確かめてから「二要素の途中」として扱う。
 *
 * サーバー専用の依存が無い（client / server の両方から安全に import できる）。
 */
export function isMfaPendingRpcError(
  error: { code?: string; message?: string } | null | undefined
): boolean {
  return error?.code === '42501' && error?.message === 'mfa_required'
}
