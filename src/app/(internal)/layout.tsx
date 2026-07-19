import { AppShell } from '@/components/layout'

// Note: force-dynamic を除去。認証チェックはmiddlewareとクライアントhooksで行うため、
// レイアウトレベルでのSSG/ISR無効化は不要。各ページが必要に応じて個別に設定する。
// QueryProvider はルート(app/layout.tsx)に集約したためここでは張らない。

export default function InternalLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <AppShell>{children}</AppShell>
}
