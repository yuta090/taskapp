import { listSharedBotAccessRequests } from '@/lib/channels/store'
import { SharedBotAccessClient } from './SharedBotAccessClient'

export const dynamic = 'force-dynamic'

// superadmin ゲートは (panel)/layout.tsx が担う（未認証は /admin/login へ redirect）。
export default async function SharedBotAccessPage() {
  const requests = await listSharedBotAccessRequests()
  return <SharedBotAccessClient initialRequests={requests} />
}
