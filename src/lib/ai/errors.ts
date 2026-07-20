/**
 * AI設定に起因する失敗の型付き例外（依存の軽いモジュールに分離）。
 * client.ts（supabase/fetch を持つ重いモジュール）から分離することで、client.ts を
 * モックするテストでも AiConfigError の instanceof 判定が壊れないようにする（digestSkip が使う）。
 *
 * decrypt_failed は「キーは登録されているが復号できない＝再設定が必要」＝設定ギャップ側に寄せる。
 */
export type AiConfigErrorKind = 'missing' | 'disabled' | 'decrypt_failed'

export class AiConfigError extends Error {
  readonly kind: AiConfigErrorKind
  constructor(kind: AiConfigErrorKind, message: string) {
    super(message)
    this.name = 'AiConfigError'
    this.kind = kind
  }
}
