/**
 * 「配達を試みる前の自分側インフラ一時障害」を表すエラーマーカー。
 *
 * 接続行/リンクのDB read・秘密の復号RPC/vault の**瞬断**(自分のDB/秘密が読めない)は、配達先が
 * 拒否したのとはカテゴリが違い、アウトボックスの attempt 予算を消費すべきでない(Fable 裁定
 * 2026-07-23)。dispatch 側はこのマーカーが付いた失敗を `infraTransientOutcome` で attempt 不変の
 * defer(72h キャップ超は temporary_fail に降格)に回す。
 *
 * ⚠ **外部送信そのもの**(multica API / gtasks API 等)の失敗にはこのマーカーを付けないこと。
 *   配達先起因は従来どおり classifyError(400/404/422=permanent、他=temporary_fail)で扱う。
 *   マーカーは「外部送信より前」の自分側 read/復号/RPC 障害だけに限定する。
 */

export interface InfraTransientMarker {
  /** true のとき dispatch はこの失敗を infra 一時障害として defer に回す。 */
  infraTransient: true
}

/** infra 一時障害マーカー付きの Error を作る(read/復号/RPC の瞬断の投出用)。 */
export function infraTransientError(message: string): Error & InfraTransientMarker {
  return Object.assign(new Error(message), { infraTransient: true as const })
}

/** エラーが infra 一時障害マーカーを持つか。dispatch の分岐用。 */
export function isInfraTransientError(err: unknown): boolean {
  return (err as { infraTransient?: unknown } | null | undefined)?.infraTransient === true
}
