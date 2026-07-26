import { freeeAdapter } from '@/lib/accounting/providers/freee'
import { misocaAdapter } from '@/lib/accounting/providers/misoca'
import { moneyForwardAdapter } from '@/lib/accounting/providers/moneyForward'
import type { AccountingAdapter, AccountingProviderId } from '@/lib/accounting/types'

/**
 * 見積書・請求書アダプタの単一真実源（**server 専用**）。
 *
 * client 側で「実装済みID一覧」だけが要る場面では、値 import を持たない
 * src/lib/accounting/implemented.ts を使うこと（task-sync と同じ理由＝アダプタ実装が
 * server 専用依存を引き込み、client バンドルへ混入すると build が落ちる）。
 * 両者のずれは src/__tests__/lib/accounting/implemented.test.ts が落として知らせる。
 */
export const ACCOUNTING_ADAPTERS: Record<AccountingProviderId, AccountingAdapter> = {
  freee: freeeAdapter,
  money_forward: moneyForwardAdapter,
  misoca: misocaAdapter,
}

export function getAccountingAdapter(id: string): AccountingAdapter | null {
  return ACCOUNTING_ADAPTERS[id as AccountingProviderId] ?? null
}
