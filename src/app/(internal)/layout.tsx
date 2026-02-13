import { AppShell } from '@/components/layout'
import { QueryProvider } from '@/components/providers/QueryProvider'

// 認証が必要なページ群のため、ビルド時の静的プリレンダリングを無効化
export const dynamic = 'force-dynamic'

export default function InternalLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <QueryProvider>
      <AppShell>{children}</AppShell>
    </QueryProvider>
  )
}
