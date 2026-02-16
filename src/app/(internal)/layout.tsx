import { AppShell } from '@/components/layout'
import { QueryProvider } from '@/components/providers/QueryProvider'

// Note: force-dynamic を除去。認証チェックはmiddlewareとクライアントhooksで行うため、
// レイアウトレベルでのSSG/ISR無効化は不要。各ページが必要に応じて個別に設定する。

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
