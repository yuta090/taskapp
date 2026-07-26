import type { AccountingProviderId } from '@/lib/accounting/types'

/**
 * アダプタ実装があり、実際に接続できる会計/請求サービスの一覧 — **client 安全な単独モジュール**。
 *
 * 値 import を一切持たない（`import type` のみ＝ビルド時に消える）。client コンポーネントが
 * 「どれが使えるか」を知るためだけに adapters.ts を import すると、アダプタ実装の依存が
 * client バンドルへ混入する（task-sync で実際に Turbopack build が落ちた経緯がある）。
 *
 * 単一真実源は adapters.ts の ACCOUNTING_ADAPTERS。両者の一致はテストが保証する。
 */
export const IMPLEMENTED_ACCOUNTING_PROVIDERS = [
  'freee',
  'money_forward',
  'misoca',
] as const satisfies readonly AccountingProviderId[]

export function implementedAccountingProviders(): AccountingProviderId[] {
  return [...IMPLEMENTED_ACCOUNTING_PROVIDERS]
}

export function isImplementedAccountingProvider(id: string): boolean {
  return (IMPLEMENTED_ACCOUNTING_PROVIDERS as readonly string[]).includes(id)
}

/**
 * 接続時に「どの事業所か」の指定が要る provider。
 *
 * freee は取引先も書類も事業所(company_id)配下にあり、指定しないと 400 になる（実機確認済み）。
 * マネーフォワード / Misoca はトークン自体が事業者に紐づくため、追加指定は要らない。
 */
export const ACCOUNTING_PROVIDER_NEEDS_COMPANY: Record<
  (typeof IMPLEMENTED_ACCOUNTING_PROVIDERS)[number],
  boolean
> = {
  freee: true,
  money_forward: false,
  misoca: false,
}
