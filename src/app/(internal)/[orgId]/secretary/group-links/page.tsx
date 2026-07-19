import { redirect } from 'next/navigation'

interface Props {
  params: Promise<{ orgId: string }>
}

/**
 * 旧URL /{orgId}/secretary/group-links → /{orgId}/secretary/connect/line/groups への恒久リダイレクト。
 * メール(groupClaimLinked)/通知(groupClaimNotify)に旧URLが流通済みのため、移設後も残す。
 */
export default async function LegacyGroupLinksPage({ params }: Props) {
  const { orgId } = await params
  redirect(`/${orgId}/secretary/connect/line/groups`)
}
