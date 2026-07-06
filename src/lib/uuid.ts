// UUIDフォーマット検証(バージョン非依存)。
// v4限定regex(4[0-9a-f]{3}-[89ab]...)は使わないこと —
// デモ組織ID等の非v4 UUIDを誤って弾く実バグの原因になった。
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isValidUuid(value: string | null | undefined): value is string {
  return typeof value === 'string' && UUID_REGEX.test(value)
}
