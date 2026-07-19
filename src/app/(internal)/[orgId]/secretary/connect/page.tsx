import { redirect } from 'next/navigation'

interface Props {
  params: Promise<{ orgId: string }>
}

/**
 * /{orgId}/secretary/connect — チャネル索引ページは作らず、既定チャネル(LINE)へ委譲。
 * つなげるチャネルがLINE単独の現状で1クリック増やさないため。
 */
export default async function ConnectIndexPage({ params }: Props) {
  const { orgId } = await params
  redirect(`/${orgId}/secretary/connect/line`)
}
