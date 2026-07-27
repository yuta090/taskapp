import {
  listOpenQuotes,
  listPendingSyncQuotes,
  listApprovedQuotesWithOrg,
  approvedWarningOf,
} from '@/lib/billing/quoteStore'
import { QuotesClient } from './QuotesClient'

export const dynamic = 'force-dynamic'

// superadmin ゲートは (panel)/layout.tsx が担う（未認証は /admin/login へ redirect）。
export default async function AdminQuotesPage() {
  const [open, pendingSync, approved] = await Promise.all([
    listOpenQuotes(),
    listPendingSyncQuotes(),
    listApprovedQuotesWithOrg(),
  ])
  return (
    <QuotesClient
      initialOpen={open}
      initialPendingSync={pendingSync}
      initialApproved={approved.rows}
      initialApprovedWarning={approvedWarningOf(approved)}
    />
  )
}
