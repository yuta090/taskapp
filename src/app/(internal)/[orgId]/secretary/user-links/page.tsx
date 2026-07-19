import { redirect } from 'next/navigation'

interface Props {
  params: Promise<{ orgId: string }>
}

/**
 * 旧URL /{orgId}/secretary/user-links → /{orgId}/secretary/connect/line への恒久リダイレクト。
 * メール/オンボーディングに旧URLが流通済みのため、ルート移設後もこのリダイレクトは残す。
 */
export default async function LegacyUserLinksPage({ params }: Props) {
  const { orgId } = await params
  redirect(`/${orgId}/secretary/connect/line`)
}
