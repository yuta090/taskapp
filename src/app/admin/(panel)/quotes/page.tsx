import { listOpenQuotes, listPendingSyncQuotes } from '@/lib/billing/quoteStore'
import { QuotesClient } from './QuotesClient'

export const dynamic = 'force-dynamic'

// superadmin ゲートは (panel)/layout.tsx が担う（未認証は /admin/login へ redirect）。
export default async function AdminQuotesPage() {
  const [open, pendingSync] = await Promise.all([listOpenQuotes(), listPendingSyncQuotes()])
  return <QuotesClient initialOpen={open} initialPendingSync={pendingSync} />
}
